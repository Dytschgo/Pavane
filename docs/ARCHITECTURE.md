# Desktop foundation

## Boundary and build

Tauri 2 owns the Windows window and uses the system WebView2 runtime. Rust owns SQLite, retention, HTTP transport, cancellation and scheduling. React 19/Vite renders the UI. There is no application server or bundled Node runtime in the desktop artifact. Radix primitives provide dialogs, menus and tooltips, with local shadcn-style components and CSS tokens.

`crates/pavane-core` contains persistence/domain behavior without Tauri or network dependencies. `src-tauri` is the native command boundary and local-model runtime. `src` contains typed IPC calls, UI and transient run state. Only harmless UI selection metadata is kept in localStorage; conversation content and drafts are saved to SQLite.

## Data and recovery

Schema version 1 creates workspaces, chats, messages and runs in an immediate transaction. Foreign keys cascade chat deletion. Indexed timestamps and message sequence keys support 100-row pages. A message page has a 4 MiB content budget; provider context is at most 100 recent complete messages and 256 KiB of content. Older context is omitted rather than silently submitted without bounds. The initial renderer loads one page; deliberately loading older pages grows its history.

Draft changes are queued to Rust in order. On successful submission, the user message, all pending response rows, runs, generated title and cleared draft commit atomically. Duplicate submission into an active chat is rejected. Output is bounded at 2 MiB per response. SQLite WAL mode, a five-second busy timeout, `secure_delete`, and foreign keys are configured before use. Database errors are redacted to a useful category, without SQL, paths or user content.

Running text is checkpointed at most every 500 ms when chunks arrive, and once on every terminal transition. An exclusive per-database file lock is acquired before recovery; a second owner cannot interrupt the first owner's runs. Startup marks unfinished responses `interrupted` without resubmitting inference. Up to the last checkpoint interval of text can be lost after a hard crash. A database with a newer schema is refused without schema changes. There is no destructive migration or automatic repair.

Before a future schema upgrade, close Pavane and copy the complete database directory, including any WAL files. Rollback of this PR restores a README-only source tree; it must not delete user data. An older binary should refuse an unsupported schema. A corrupt or inaccessible database produces a startup failure rather than replacing it with an empty store. Automated backup/restore UI remains future work.

## Delete Soon

Expiry is fixed at creation + 30 × 24 hours in UTC milliseconds, not extended by activity. Queries and writes reject an expired chat at the exact boundary even before cleanup. `Keep this chat` clears its deadline only while it is still alive. Startup and a 60-second native timer purge expired chats and their message/run rows; active streams for purged chats are cancelled. While the app is closed, physical cleanup waits for the next launch. Device clock changes can shift the observed deadline.

The setting governs local persistence only. No app can promise deletion of OS snapshots, manual backups, or copies held by a provider. A future attachment adapter must join the same retention lifecycle before attachments are enabled.

## Runs and provider boundary

Ollama is the only working inference adapter in this slice. HTTP is restricted to `127.0.0.1:11434`, bypasses proxies, and refuses redirects. It receives no filesystem tools or credentials. Cloud-tagged models are rejected. A selected local model can itself have substantial RAM requirements; Pavane's memory measurements must be reported separately from inference.

The native scheduler allows four executing requests and eight total active/queued runs. A chat accepts one prompt at a time; a prompt may create up to four independent model responses. This implements comparison fan-out, not autonomous multi-agent orchestration. Cancellation aborts the native HTTP future and saves partial text, but a provider may continue work after the client disconnects. Runs have a ten-minute timeout. Queue, HTTP and decoder limits are enforced in Rust, independent of UI controls.

Transport NDJSON is decoded across arbitrary byte and UTF-8 boundaries with a 256 KiB per-frame limit. Text is coalesced for IPC at roughly 40 ms or 4 KiB; final text is flushed before terminal status. The renderer retains a bounded live-response cache to preserve text when switching conversations during a stream. Native checkpoints are authoritative after reload.

Consumer subscriptions and API billing are separate integrations. A future adapter must declare supported models, authentication, text/tools/media capabilities, limit data source, cancellation and recovery. Unknown quota stays unknown. No OAuth tokens or API keys are accepted or stored in this version. Use OS-protected credential storage for future API adapters and avoid reusing another app's private token files.

## UI security

Only local bundled content runs in the desktop WebView. CSP excludes remote scripts and frames. The renderer uses explicit native commands with no shell/filesystem plugins. Model and user text render as text, without raw HTML execution. Dialogs and menus use accessible Radix behavior. No provider tools execute. There is no telemetry, cloud synchronization, authentication system or billing infrastructure.

## Verification and remaining risks

Saving is acknowledged after all queued draft writes finish. Failed unsaved drafts are retained across navigation in the current renderer and labeled unsaved; a process crash cannot preserve text that never reached SQLite. A draft is accepted only after its native chat exists. Selected-chat metadata and expiry remain independent of sidebar search/paging, and expired content is cleared from the renderer's live cache.

Reloading the renderer no longer aborts native inference when its original IPC channel disappears. The new renderer polls selected active message snapshots every 500 ms until completion, keeping Stop usable. Partial checkpoints and terminal states remain authoritative. A second app process fails safely on the ownership lock; focusing the existing window on a second launch is future polish.

[TESTING.md](TESTING.md) separates storage tests, decoder tests, renderer tests, native smoke evidence and release build checks. Native smoke uses synthetic local responses and cannot establish real model quality or provider entitlement. This is an unsigned development foundation; cross-platform builds, automatic database backups, provider capability parity, autonomous agents and installers need their own reviewed work.
