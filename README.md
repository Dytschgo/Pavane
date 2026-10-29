# Pavane

A local desktop workspace for conversations, projects, spaces, bots, images, and video. Windows first, with a Rust core, SQLite storage, and a compact interface inspired by shadcn/ui.

## Run locally

Requires Node.js 24+, pnpm 10.34.5, stable Rust, the Microsoft C++ build tools, and WebView2. See [Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows).

```powershell
pnpm install --frozen-lockfile
pnpm desktop
```

To use a model, start Ollama with a local model already installed, open **Connections**, and connect. The adapter uses `127.0.0.1:11434`; cloud-tagged models are excluded. Pavane never downloads a model or installs a provider automatically.

```powershell
pnpm check
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
pnpm desktop:build
```

The standalone Windows executable is `target/release/pavane.exe`. This foundation has no installer, signing, updater, telemetry, account, hosted service, or cloud sync.

## What works

- SQLite conversations and drafts that survive reloads and restarts.
- **Delete Soon** chats saved for 30 days from creation, with an option to keep them.
- Local Ollama model discovery and streaming, partial-response recovery, and cancellation.
- Up to four parallel model responses per prompt, with a bounded native queue.
- Projects, spaces, and bots with reusable instructions and grouped conversations.
- Six workflow routes, keyboard navigation, model search, and connection settings.

Subscription bridges, provider-reported limits, autonomous agent swarms, attachments, and image/video generation are tracked in [TASKS.md](TASKS.md). Their interface scaffolds are labeled **Planned**. Parallel model comparison does not delegate tools or create autonomous agents.

## Your data

The Windows database is `%LOCALAPPDATA%/cloud.pavane.desktop/pavane.sqlite3`, managed by Rust. The renderer has no filesystem or shell plugin. Sending a message shares a bounded window of that chat and its workspace instructions with the selected model service. SQLite is not encrypted; your Windows account and device protection matter.

Expired chats become unreadable at their deadline, are purged at startup and at least every minute while Pavane runs, and are removed on the next start if the app was closed. Related messages and runs cascade with the chat. This is logical deletion, not a guarantee of erasing backups, filesystem snapshots, or provider-side history. See [architecture and recovery](docs/ARCHITECTURE.md).

## Development

[Verification](docs/TESTING.md) describes native smoke tests and isolated data. [Design](docs/DESIGN.md), [decisions](docs/decisions/DECISION-LOG.md), and the [current handoff](docs/handoff/CURRENT-HANDOFF.md) record the first-version scope. `pnpm dev` opens an interface-only web build; durable operations require the desktop app.

The source is public. The project owner has deferred choosing a license; no project license is granted by this repository yet. Dependencies retain their own licenses. No T3 Code source was copied.
