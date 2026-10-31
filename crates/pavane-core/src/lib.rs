use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::{path::Path, time::Duration};
use uuid::Uuid;

pub const DELETE_SOON_MS: i64 = 30 * 24 * 60 * 60 * 1_000;
pub const MAX_PROMPT_BYTES: usize = 64 * 1024;
pub const MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
pub type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chat {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub expires_at: Option<i64>,
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub chat_id: String,
    pub role: String,
    pub content: String,
    pub model: Option<String>,
    pub status: String,
    pub created_at: i64,
    pub sequence: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub instructions: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub chat_id: String,
    pub message_id: String,
    pub model: String,
}

pub struct Store(Connection, Option<std::fs::File>);

fn validate_workspace(kind: &str, name: &str, instructions: &str) -> Result<()> {
    if !["projects", "spaces", "bots"].contains(&kind)
        || name.trim().is_empty()
        || name.chars().count() > 80
        || instructions.len() > 8192
    {
        return Err(
            "Use a workspace name of up to 80 characters and instructions of up to 8 KiB.".into(),
        );
    }
    Ok(())
}

fn sql(error: rusqlite::Error) -> String {
    // Do not expose SQL text, file paths or user content through native errors.
    match error {
        rusqlite::Error::SqliteFailure(code, _) => {
            format!("Local storage error ({:?}).", code.code)
        }
        _ => "Unable to read or save local data.".into(),
    }
}

fn chat_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Chat> {
    Ok(Chat {
        id: row.get(0)?,
        title: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
        expires_at: row.get(4)?,
        workspace_id: row.get(5)?,
    })
}

fn message_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Message> {
    Ok(Message {
        id: row.get(0)?,
        chat_id: row.get(1)?,
        role: row.get(2)?,
        content: row.get(3)?,
        model: row.get(4)?,
        status: row.get(5)?,
        created_at: row.get(6)?,
        sequence: row.get(7)?,
    })
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        // Own the database before crash recovery. A second process must never
        // mark another live process's responses interrupted.
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path.with_extension("sqlite3.lock"))
            .map_err(|_| "Unable to open the database lock.".to_string())?;
        fs2::FileExt::try_lock_exclusive(&lock).map_err(|_| {
            "This database is already open in another Pavane window. Close that window first."
                .to_string()
        })?;
        let mut store = Self::from_connection(Connection::open(path).map_err(sql)?)?;
        store.1 = Some(lock);
        Ok(store)
    }

    pub fn memory() -> Result<Self> {
        Self::from_connection(Connection::open_in_memory().map_err(sql)?)
    }

    fn from_connection(connection: Connection) -> Result<Self> {
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(sql)?;
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;
             PRAGMA secure_delete = ON; PRAGMA synchronous = NORMAL;",
            )
            .map_err(sql)?;
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(sql)?;
        if version > 1 {
            return Err(
                "This database needs a newer version of Pavane. Your data has not been changed."
                    .into(),
            );
        }
        if version == 0 {
            connection.execute_batch(
                "BEGIN IMMEDIATE;
                 CREATE TABLE workspaces (
                    id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('projects','spaces','bots')),
                    name TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT ''
                 );
                 CREATE TABLE chats (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL, expires_at INTEGER,
                    workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
                    draft TEXT NOT NULL DEFAULT ''
                 );
                 CREATE INDEX chats_recent ON chats(updated_at DESC, id);
                 CREATE INDEX chats_expiry ON chats(expires_at) WHERE expires_at IS NOT NULL;
                 CREATE TABLE messages (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
                    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK(role IN ('user','assistant')),
                    content TEXT NOT NULL DEFAULT '', model TEXT,
                    status TEXT NOT NULL CHECK(status IN ('complete','pending','running','failed','cancelled','interrupted')),
                    created_at INTEGER NOT NULL
                 );
                 CREATE INDEX messages_chat ON messages(chat_id, sequence DESC);
                 CREATE TABLE runs (
                    id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
                    message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
                    model TEXT NOT NULL
                 );
                 PRAGMA user_version = 1;
                 COMMIT;",
            ).map_err(sql)?;
        }
        // Recover a crashed process without silently replaying provider requests.
        connection
            .execute(
                "UPDATE messages SET status='interrupted' WHERE status IN ('pending','running')",
                [],
            )
            .map_err(sql)?;
        Ok(Self(connection, None))
    }

    pub fn create_chat(
        &self,
        delete_soon: bool,
        workspace_id: Option<&str>,
        now: i64,
    ) -> Result<Chat> {
        if let Some(id) = workspace_id {
            let exists: bool = self
                .0
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=?1)",
                    [id],
                    |r| r.get(0),
                )
                .map_err(sql)?;
            if !exists {
                return Err("This workspace no longer exists.".into());
            }
        }
        let chat = Chat {
            id: Uuid::new_v4().to_string(),
            title: "New chat".into(),
            created_at: now,
            updated_at: now,
            expires_at: delete_soon.then_some(now + DELETE_SOON_MS),
            workspace_id: workspace_id.map(str::to_owned),
        };
        self.0.execute("INSERT INTO chats(id,title,created_at,updated_at,expires_at,workspace_id) VALUES (?1,?2,?3,?4,?5,?6)",
            params![chat.id, chat.title, now, now, chat.expires_at, chat.workspace_id]).map_err(sql)?;
        Ok(chat)
    }

    pub fn list_chats(&self, now: i64, offset: u32, search: &str) -> Result<Vec<Chat>> {
        if search.len() > 256 {
            return Err("Search is too long.".into());
        }
        let mut statement = self
            .0
            .prepare(
                "SELECT id,title,created_at,updated_at,expires_at,workspace_id FROM chats
             WHERE (expires_at IS NULL OR expires_at>?1) AND instr(lower(title),lower(?2))>0
             ORDER BY updated_at DESC,id LIMIT 100 OFFSET ?3",
            )
            .map_err(sql)?;
        statement
            .query_map(params![now, search, offset], chat_row)
            .map_err(sql)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(sql)
    }

    fn require_chat(&self, id: &str, now: i64) -> Result<()> {
        let exists: bool = self.0.query_row("SELECT EXISTS(SELECT 1 FROM chats WHERE id=?1 AND (expires_at IS NULL OR expires_at>?2))", params![id, now], |r| r.get(0)).map_err(sql)?;
        if exists {
            Ok(())
        } else {
            Err("This chat has expired or is no longer available.".into())
        }
    }

    pub fn messages(&self, chat_id: &str, before: Option<i64>, now: i64) -> Result<Vec<Message>> {
        self.require_chat(chat_id, now)?;
        let mut statement = self
            .0
            .prepare(
                "SELECT id,chat_id,role,content,model,status,created_at,sequence FROM messages
             WHERE chat_id=?1 AND sequence<?2 ORDER BY sequence DESC LIMIT 100",
            )
            .map_err(sql)?;
        let rows = statement
            .query_map(params![chat_id, before.unwrap_or(i64::MAX)], message_row)
            .map_err(sql)?;
        let mut messages = Vec::new();
        let mut bytes = 0;
        for row in rows {
            let message = row.map_err(sql)?;
            if bytes + message.content.len() > 4 * 1024 * 1024 {
                break;
            }
            bytes += message.content.len();
            messages.push(message);
        }
        messages.reverse();
        Ok(messages)
    }

    pub fn has_older(&self, chat_id: &str, first: i64) -> Result<bool> {
        self.0
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM messages WHERE chat_id=?1 AND sequence<?2)",
                params![chat_id, first],
                |r| r.get(0),
            )
            .map_err(sql)
    }

    pub fn draft(&self, chat_id: &str, now: i64) -> Result<String> {
        self.require_chat(chat_id, now)?;
        self.0
            .query_row("SELECT draft FROM chats WHERE id=?1", [chat_id], |r| {
                r.get(0)
            })
            .map_err(sql)
    }

    pub fn save_draft(&self, chat_id: &str, content: &str, now: i64) -> Result<()> {
        self.require_chat(chat_id, now)?;
        if content.len() > MAX_PROMPT_BYTES {
            return Err("Draft is too long (64 KiB maximum).".into());
        }
        self.0
            .execute(
                "UPDATE chats SET draft=?2 WHERE id=?1",
                params![chat_id, content],
            )
            .map_err(sql)?;
        Ok(())
    }

    pub fn rename(&self, chat_id: &str, title: &str, now: i64) -> Result<()> {
        self.require_chat(chat_id, now)?;
        let title = title.trim();
        if title.is_empty() || title.chars().count() > 120 {
            return Err("Use a title between 1 and 120 characters.".into());
        }
        self.0
            .execute(
                "UPDATE chats SET title=?2 WHERE id=?1",
                params![chat_id, title],
            )
            .map_err(sql)?;
        Ok(())
    }

    pub fn keep_chat(&self, chat_id: &str, now: i64) -> Result<()> {
        self.require_chat(chat_id, now)?;
        self.0
            .execute("UPDATE chats SET expires_at=NULL WHERE id=?1", [chat_id])
            .map_err(sql)?;
        Ok(())
    }

    pub fn delete_chat(&self, chat_id: &str) -> Result<()> {
        self.0
            .execute("DELETE FROM chats WHERE id=?1", [chat_id])
            .map_err(sql)?;
        Ok(())
    }

    pub fn purge_expired(&self, now: i64) -> Result<Vec<String>> {
        let mut statement = self.0.prepare("SELECT runs.id FROM runs JOIN chats ON chats.id=runs.chat_id WHERE chats.expires_at<=?1").map_err(sql)?;
        let ids = statement
            .query_map([now], |r| r.get(0))
            .map_err(sql)?
            .collect::<std::result::Result<Vec<String>, _>>()
            .map_err(sql)?;
        drop(statement);
        self.0
            .execute("DELETE FROM chats WHERE expires_at<=?1", [now])
            .map_err(sql)?;
        Ok(ids)
    }

    pub fn begin_turn(
        &mut self,
        chat_id: &str,
        content: &str,
        models: &[String],
        now: i64,
    ) -> Result<(Message, Vec<Run>)> {
        self.require_chat(chat_id, now)?;
        if content.trim().is_empty() || content.len() > MAX_PROMPT_BYTES {
            return Err("Write a message of up to 64 KiB.".into());
        }
        if models.is_empty()
            || models.len() > 4
            || models.iter().any(|m| m.is_empty() || m.len() > 256)
        {
            return Err("Choose between one and four models.".into());
        }
        let active: bool = self.0.query_row("SELECT EXISTS(SELECT 1 FROM messages WHERE chat_id=?1 AND status IN ('pending','running'))", [chat_id], |r| r.get(0)).map_err(sql)?;
        if active {
            return Err("Wait for this chat's current run, or stop it first.".into());
        }
        let transaction = self.0.transaction().map_err(sql)?;
        let user_id = Uuid::new_v4().to_string();
        transaction.execute("INSERT INTO messages(id,chat_id,role,content,status,created_at) VALUES (?1,?2,'user',?3,'complete',?4)", params![user_id,chat_id,content,now]).map_err(sql)?;
        let user_sequence = transaction.last_insert_rowid();
        let mut runs = Vec::new();
        for model in models {
            let run = Run {
                id: Uuid::new_v4().to_string(),
                chat_id: chat_id.into(),
                message_id: Uuid::new_v4().to_string(),
                model: model.clone(),
            };
            transaction.execute("INSERT INTO messages(id,chat_id,role,model,status,created_at) VALUES (?1,?2,'assistant',?3,'pending',?4)", params![run.message_id,chat_id,model,now]).map_err(sql)?;
            transaction
                .execute(
                    "INSERT INTO runs(id,chat_id,message_id,model) VALUES (?1,?2,?3,?4)",
                    params![run.id, chat_id, run.message_id, model],
                )
                .map_err(sql)?;
            runs.push(run);
        }
        let title: String = content
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(64)
            .collect();
        transaction.execute("UPDATE chats SET title=CASE WHEN title='New chat' THEN ?2 ELSE title END,updated_at=?3,draft='' WHERE id=?1", params![chat_id,title,now]).map_err(sql)?;
        transaction.commit().map_err(sql)?;
        Ok((
            Message {
                id: user_id,
                chat_id: chat_id.into(),
                role: "user".into(),
                content: content.into(),
                model: None,
                status: "complete".into(),
                created_at: now,
                sequence: user_sequence,
            },
            runs,
        ))
    }

    pub fn update_run(&self, run: &Run, content: &str, status: &str, now: i64) -> Result<()> {
        self.require_chat(&run.chat_id, now)?;
        if content.len() > MAX_OUTPUT_BYTES
            || !["running", "complete", "failed", "cancelled", "interrupted"].contains(&status)
        {
            return Err("Invalid run update.".into());
        }
        let changed = self.0.execute("UPDATE messages SET content=?2,status=?3 WHERE id=?1 AND status IN ('pending','running')", params![run.message_id,content,status]).map_err(sql)?;
        if changed == 0 {
            return Err("This run has already ended.".into());
        }
        Ok(())
    }

    pub fn context(&self, chat_id: &str, now: i64) -> Result<Vec<Message>> {
        let messages = self.messages(chat_id, None, now)?;
        let mut bytes = 0;
        let mut result = Vec::new();
        for message in messages
            .into_iter()
            .rev()
            .filter(|m| m.status == "complete")
        {
            bytes += message.content.len();
            if bytes > 256 * 1024 {
                break;
            }
            result.push(message);
        }
        result.reverse();
        Ok(result)
    }

    pub fn workspaces(&self) -> Result<Vec<Workspace>> {
        let mut statement = self
            .0
            .prepare("SELECT id,kind,name,instructions FROM workspaces ORDER BY name LIMIT 200")
            .map_err(sql)?;
        statement
            .query_map([], |r| {
                Ok(Workspace {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    name: r.get(2)?,
                    instructions: r.get(3)?,
                })
            })
            .map_err(sql)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(sql)
    }

    pub fn create_workspace(
        &self,
        kind: &str,
        name: &str,
        instructions: &str,
    ) -> Result<Workspace> {
        validate_workspace(kind, name, instructions)?;
        let workspace = Workspace {
            id: Uuid::new_v4().to_string(),
            kind: kind.into(),
            name: name.trim().into(),
            instructions: instructions.into(),
        };
        self.0
            .execute(
                "INSERT INTO workspaces(id,kind,name,instructions) VALUES (?1,?2,?3,?4)",
                params![
                    workspace.id,
                    workspace.kind,
                    workspace.name,
                    workspace.instructions
                ],
            )
            .map_err(sql)?;
        Ok(workspace)
    }

    pub fn workspace(&self, id: &str) -> Result<Workspace> {
        if Uuid::parse_str(id).is_err() {
            return Err("This workspace no longer exists.".into());
        }
        self.0
            .query_row(
                "SELECT id,kind,name,instructions FROM workspaces WHERE id=?1",
                [id],
                |r| {
                    Ok(Workspace {
                        id: r.get(0)?,
                        kind: r.get(1)?,
                        name: r.get(2)?,
                        instructions: r.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(sql)?
            .ok_or_else(|| "This workspace no longer exists.".into())
    }

    pub fn update_workspace(
        &self,
        expected: &Workspace,
        name: &str,
        instructions: &str,
    ) -> Result<Workspace> {
        if Uuid::parse_str(&expected.id).is_err() {
            return Err("This workspace no longer exists.".into());
        }
        validate_workspace(&expected.kind, &expected.name, &expected.instructions)?;
        validate_workspace(&expected.kind, name, instructions)?;
        let saved = Workspace {
            id: expected.id.clone(),
            kind: expected.kind.clone(),
            name: name.trim().into(),
            instructions: instructions.into(),
        };
        let changed = self.0.execute(
            "UPDATE workspaces SET name=?1,instructions=?2 WHERE id=?3 AND kind=?4 AND name=?5 AND instructions=?6",
            params![saved.name, saved.instructions, expected.id, expected.kind, expected.name, expected.instructions],
        ).map_err(sql)?;
        if changed != 1 {
            return Err("This workspace changed or no longer exists. Load the saved version before editing again.".into());
        }
        Ok(saved)
    }

    pub fn instructions(&self, chat_id: &str) -> Result<Option<String>> {
        self.0.query_row("SELECT workspaces.instructions FROM chats JOIN workspaces ON chats.workspace_id=workspaces.id WHERE chats.id=?1", [chat_id], |r| r.get(0)).optional().map_err(sql)
    }
}
