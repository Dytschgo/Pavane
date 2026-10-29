mod codex;
mod provider;

use pavane_core::{Chat, Message, Run, Store, Workspace};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State, ipc::Channel};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

pub(crate) fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

struct Runtime {
    store: Mutex<Store>,
    active: Mutex<HashMap<String, (String, CancellationToken)>>,
    slots: Arc<Semaphore>,
    client: reqwest::Client,
    codex: codex::Manager,
}

impl Runtime {
    fn with_store<T>(
        &self,
        action: impl FnOnce(&mut Store) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut store = self
            .store
            .lock()
            .map_err(|_| "Local storage is unavailable. Restart Pavane.".to_string())?;
        action(&mut store)
    }

    fn cleanup(&self) -> Result<(), String> {
        let expired = self.with_store(|store| store.purge_expired(now()))?;
        if let Ok(active) = self.active.lock() {
            for id in expired {
                if let Some((_, token)) = active.get(&id) {
                    token.cancel();
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunEvent {
    run_id: String,
    chat_id: String,
    message_id: String,
    kind: String,
    delta: String,
    status: String,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TurnStarted {
    user: Message,
    runs: Vec<Run>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MessagePage {
    items: Vec<Message>,
    has_more: bool,
}

#[tauri::command]
fn list_chats(
    runtime: State<'_, Arc<Runtime>>,
    offset: u32,
    search: String,
) -> Result<Vec<Chat>, String> {
    runtime.cleanup()?;
    runtime.with_store(|store| store.list_chats(now(), offset, &search))
}

#[tauri::command]
fn create_chat(
    runtime: State<'_, Arc<Runtime>>,
    delete_soon: bool,
    workspace_id: Option<String>,
) -> Result<Chat, String> {
    runtime.with_store(|store| store.create_chat(delete_soon, workspace_id.as_deref(), now()))
}

#[tauri::command]
fn get_messages(
    runtime: State<'_, Arc<Runtime>>,
    chat_id: String,
    before: Option<i64>,
) -> Result<MessagePage, String> {
    runtime.with_store(|store| {
        let items = store.messages(&chat_id, before, now())?;
        let has_more = match items.first() {
            Some(first) => store.has_older(&chat_id, first.sequence)?,
            None => false,
        };
        Ok(MessagePage { items, has_more })
    })
}

#[tauri::command]
fn get_draft(runtime: State<'_, Arc<Runtime>>, chat_id: String) -> Result<String, String> {
    runtime.with_store(|store| store.draft(&chat_id, now()))
}

#[tauri::command]
fn save_draft(
    runtime: State<'_, Arc<Runtime>>,
    chat_id: String,
    content: String,
) -> Result<(), String> {
    runtime.with_store(|store| store.save_draft(&chat_id, &content, now()))
}

#[tauri::command]
fn rename_chat(
    runtime: State<'_, Arc<Runtime>>,
    chat_id: String,
    title: String,
) -> Result<(), String> {
    runtime.with_store(|store| store.rename(&chat_id, &title, now()))
}

#[tauri::command]
fn keep_chat(runtime: State<'_, Arc<Runtime>>, chat_id: String) -> Result<(), String> {
    runtime.with_store(|store| store.keep_chat(&chat_id, now()))
}

#[tauri::command]
fn stop_chat(runtime: State<'_, Arc<Runtime>>, chat_id: String) -> Result<(), String> {
    let active = runtime
        .active
        .lock()
        .map_err(|_| "Unable to stop this run.".to_string())?;
    for (id, token) in active.values() {
        if *id == chat_id {
            token.cancel();
        }
    }
    Ok(())
}

#[tauri::command]
fn delete_chat(runtime: State<'_, Arc<Runtime>>, chat_id: String) -> Result<(), String> {
    stop_chat(runtime.clone(), chat_id.clone())?;
    runtime.with_store(|store| store.delete_chat(&chat_id))
}

#[tauri::command]
fn list_workspaces(runtime: State<'_, Arc<Runtime>>) -> Result<Vec<Workspace>, String> {
    runtime.with_store(|store| store.workspaces())
}

#[tauri::command]
fn create_workspace(
    runtime: State<'_, Arc<Runtime>>,
    kind: String,
    name: String,
    instructions: String,
) -> Result<Workspace, String> {
    runtime.with_store(|store| store.create_workspace(&kind, &name, &instructions))
}

#[tauri::command]
async fn discover_models(runtime: State<'_, Arc<Runtime>>) -> Result<Vec<provider::Model>, String> {
    provider::discover(&runtime.client).await
}

#[derive(Serialize)]
struct Catalog {
    models: Vec<provider::Model>,
    providers: Vec<codex::Status>,
}

#[tauri::command]
async fn discover_providers(runtime: State<'_, Arc<Runtime>>) -> Result<Catalog, String> {
    let (codex, ollama) =
        tokio::join!(runtime.codex.catalog(), provider::discover(&runtime.client));
    let mut models = Vec::new();
    let mut providers = Vec::new();
    match codex {
        Ok((available, status)) => {
            models.extend(available);
            providers.push(status);
        }
        Err(error) => providers.push(codex::Status {
            id: "codex".into(),
            name: "Codex".into(),
            state: "unavailable".into(),
            detail: error,
            limits: vec![],
        }),
    }
    match ollama {
        Ok(available) => {
            providers.push(codex::Status {
                id: "ollama".into(),
                name: "Ollama".into(),
                state: "connected".into(),
                detail: format!("{} local models", available.len()),
                limits: vec![],
            });
            models.extend(available);
        }
        Err(_) => providers.push(codex::Status {
            id: "ollama".into(),
            name: "Ollama".into(),
            state: "unavailable".into(),
            detail: "Start Ollama on this device to use local models.".into(),
            limits: vec![],
        }),
    }
    Ok(Catalog { models, providers })
}

#[tauri::command]
async fn send_message(
    runtime: State<'_, Arc<Runtime>>,
    chat_id: String,
    content: String,
    models: Vec<String>,
    options: Option<HashMap<String, provider::ModelOptions>>,
    on_event: Channel<RunEvent>,
) -> Result<TurnStarted, String> {
    let options = options.unwrap_or_default();
    if models.iter().any(|model| {
        !(model.starts_with("ollama:") || model.starts_with("codex:"))
            || model.split_once(':').is_none_or(|(_, id)| id.is_empty())
            || model.ends_with(":cloud")
            || model.ends_with("-cloud")
    }) {
        return Err("Connect an available provider and choose a model.".into());
    }
    for model in &models {
        if model.starts_with("codex:") {
            let selected = options.get(model).cloned().unwrap_or_default();
            runtime
                .codex
                .validate(
                    model,
                    selected.reasoning_effort.as_deref(),
                    selected.service_tier.as_deref(),
                )
                .await?;
        }
    }
    let runtime = runtime.inner().clone();
    let mut active = runtime
        .active
        .lock()
        .map_err(|_| "Unable to start this run.".to_string())?;
    if active.len() + models.len() > 8 {
        return Err("The queue is full. Wait for a response or stop a run first.".into());
    }
    let (user, runs, context, instructions) = runtime.with_store(|store| {
        let instructions = store.instructions(&chat_id)?;
        let mut context = store.context(&chat_id, now())?;
        let (user, runs) = store.begin_turn(&chat_id, &content, &models, now())?;
        context.push(user.clone());
        let mut bytes: usize = context.iter().map(|message| message.content.len()).sum();
        while context.len() > 100 || bytes > 256 * 1024 {
            bytes -= context.remove(0).content.len();
        }
        Ok((user, runs, context, instructions))
    })?;
    // Register all cancellation tokens before starting any task.
    let tokens: Vec<_> = runs.iter().map(|_| CancellationToken::new()).collect();
    for (run, token) in runs.iter().zip(&tokens) {
        active.insert(run.id.clone(), (run.chat_id.clone(), token.clone()));
    }
    drop(active);
    for (run, token) in runs.iter().cloned().zip(tokens) {
        let options = options.get(&run.model).cloned().unwrap_or_default();
        let (runtime, context, instructions, channel) = (
            runtime.clone(),
            context.clone(),
            instructions.clone(),
            on_event.clone(),
        );
        tauri::async_runtime::spawn(async move {
            run_model(runtime, run, context, instructions, token, channel, options).await;
        });
    }
    Ok(TurnStarted { user, runs })
}

async fn run_model(
    runtime: Arc<Runtime>,
    run: Run,
    context: Vec<Message>,
    instructions: Option<String>,
    token: CancellationToken,
    channel: Channel<RunEvent>,
    options: provider::ModelOptions,
) {
    let mut output = String::new();
    let mut pending = String::new();
    let mut last_emit = std::time::Instant::now();
    let mut last_save = std::time::Instant::now();
    let work = async {
        let _slot = runtime
            .slots
            .acquire()
            .await
            .map_err(|_| "The run queue is unavailable.".to_string())?;
        runtime.with_store(|store| store.update_run(&run, "", "running", now()))?;
        let _ = channel.send(RunEvent {
            run_id: run.id.clone(),
            chat_id: run.chat_id.clone(),
            message_id: run.message_id.clone(),
            kind: "status".into(),
            delta: String::new(),
            status: "running".into(),
            error: None,
        });
        let on_delta = |delta: &str| {
            if output.len() + delta.len() > pavane_core::MAX_OUTPUT_BYTES {
                return Err("Response reached the 2 MiB safety limit.".into());
            }
            output.push_str(delta);
            pending.push_str(delta);
            if last_emit.elapsed().as_millis() >= 40 || pending.len() >= 4096 {
                let _ = channel.send(RunEvent {
                    run_id: run.id.clone(),
                    chat_id: run.chat_id.clone(),
                    message_id: run.message_id.clone(),
                    kind: "delta".into(),
                    delta: std::mem::take(&mut pending),
                    status: "running".into(),
                    error: None,
                });
                last_emit = std::time::Instant::now();
            }
            if last_save.elapsed().as_millis() >= 500 {
                runtime.with_store(|store| store.update_run(&run, &output, "running", now()))?;
                last_save = std::time::Instant::now();
            }
            Ok(())
        };
        if let Some(model) = run.model.strip_prefix("codex:") {
            runtime
                .codex
                .stream(
                    model,
                    &context,
                    instructions.as_deref(),
                    &options,
                    &token,
                    on_delta,
                )
                .await
        } else {
            provider::stream(
                &runtime.client,
                &run.model[7..],
                &context,
                instructions.as_deref(),
                on_delta,
            )
            .await
        }
    };
    let outcome = tokio::select! {
        biased;
        _ = token.cancelled() => Err("Run stopped.".to_string()),
        result = tokio::time::timeout(std::time::Duration::from_secs(600), work) => result.unwrap_or_else(|_| Err("The model timed out. You can try again.".into())),
    };
    let status = if token.is_cancelled() {
        "cancelled"
    } else if outcome.is_ok() {
        "complete"
    } else {
        "failed"
    };
    let saved = runtime.with_store(|store| store.update_run(&run, &output, status, now()));
    let error = saved.err().or_else(|| outcome.err());
    // Flush remaining text with the terminal event, even for failures or cancellation.
    let _ = channel.send(RunEvent {
        run_id: run.id.clone(),
        chat_id: run.chat_id.clone(),
        message_id: run.message_id.clone(),
        kind: "finished".into(),
        delta: pending,
        status: if error.is_some() && status == "complete" {
            "failed".into()
        } else {
            status.into()
        },
        error,
    });
    if let Ok(mut active) = runtime.active.lock() {
        active.remove(&run.id);
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let data = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let database = std::env::var_os("PAVANE_DATA_DIR")
                .filter(|_| cfg!(debug_assertions))
                .map(std::path::PathBuf::from)
                .unwrap_or(data);
            std::fs::create_dir_all(&database)?;
            let runtime = Arc::new(Runtime {
                store: Mutex::new(
                    Store::open(&database.join("pavane.sqlite3")).map_err(std::io::Error::other)?,
                ),
                active: Mutex::new(HashMap::new()),
                slots: Arc::new(Semaphore::new(4)),
                client: reqwest::Client::builder()
                    .no_proxy()
                    .redirect(reqwest::redirect::Policy::none())
                    .connect_timeout(std::time::Duration::from_secs(3))
                    .build()?,
                codex: codex::Manager::new(database.join("codex-workspace")),
            });
            runtime.cleanup().map_err(std::io::Error::other)?;
            app.manage(runtime.clone());
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
                loop {
                    interval.tick().await;
                    let _ = runtime.cleanup();
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_chats,
            create_chat,
            get_messages,
            get_draft,
            save_draft,
            rename_chat,
            keep_chat,
            delete_chat,
            stop_chat,
            list_workspaces,
            create_workspace,
            discover_models,
            discover_providers,
            send_message
        ])
        .build(tauri::generate_context!())
        .expect("Pavane could not start. Check the local database and WebView2 installation.");
    app.run(|app, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            app.state::<Arc<Runtime>>().codex.shutdown();
        }
    });
}
