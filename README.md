# Pavane

A local desktop workspace for conversations, projects, spaces, bots, images, and video. Windows first, with a Rust core, SQLite storage, and a compact interface inspired by shadcn/ui.

## Run locally

Requires Node.js 24+, pnpm 10.34.5, stable Rust, the Microsoft C++ build tools, and WebView2. See [Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows).

```powershell
pnpm install --frozen-lockfile
pnpm desktop
```

If Codex CLI is installed and signed in with ChatGPT, Pavane discovers its models and selects the default automatically. Open the composer model picker to choose a model, reasoning level or supported service tier. Your login stays with Codex; Pavane never copies its credentials. See the [official Codex setup](https://developers.openai.com/codex/cli/).

Local Ollama models are discovered automatically too. Start Ollama with a local model already installed; **Connections** refreshes discovery and shows provider status. Ollama uses `127.0.0.1:11434`; cloud-tagged models are excluded. Pavane never downloads a model or installs a provider automatically.

```powershell
pnpm check
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
pnpm desktop:build
```

The standalone Windows executable is `target/release/pavane.exe`. This foundation has no installer, signing, updater, Pavane account, hosted service, or cloud sync. Provider services have their own accounts and data policies.

For a separate local database, launch `pavane.exe --profile playground`. Normal launch retains your existing data. Profiles share CLI-owned logins; the new Gemini API path scopes its key separately to each profile; see [verification and profile boundaries](docs/TESTING.md).

The current PR includes a [Gemini API connection](docs/GEMINI-API.md) with Windows-protected keys and text streaming. Baseline942e87a passed CI mock/vault checks and16 native workflows, including empty-key connection controls and composition-safe Escape; live key/inference remains unverified. This is an API-key route with separate usage/billing.

## What works

- SQLite conversations and drafts that survive reloads and restarts.
- **Delete Soon** chats saved for 30 days from creation, with an option to keep them.
- Local Ollama model discovery and streaming, partial-response recovery, and cancellation.
- Codex subscription chat through the official local app-server, with real model capabilities and provider-reported usage windows.
- Searchable model picker, favourites, remembered reasoning/tier settings and Ctrl+1–9 favourite shortcuts.
- Markdown replies, lists, tables and code blocks with copy actions; safe web links open in your default browser.
- Up to four parallel model responses per prompt, with a bounded native queue.
- Projects, spaces, and bots with reusable instructions and grouped conversations.
- Edit their saved names and instructions from the pencil beside the workspace name. Conflicting edits are rejected; failed saves keep your text.
- Six workflow routes, keyboard navigation, model search, and connection settings.

Additional provider adapters, autonomous agent swarms, attachments, and image/video generation are tracked in [TASKS.md](TASKS.md). Their interface scaffolds are labeled **Planned**. Parallel model comparison does not delegate tools or create autonomous agents.

## Your data

The Windows database is `%LOCALAPPDATA%/cloud.pavane.desktop/pavane.sqlite3`, managed by Rust. The renderer has no filesystem or shell plugin. Sending a message shares a bounded window of that chat and its workspace instructions with the selected model service. SQLite is not encrypted; your Windows account and device protection matter.

Expired chats become unreadable at their deadline, are purged at startup and at least every minute while Pavane runs, and are removed on the next start if the app was closed. Related messages and runs cascade with the chat. This is logical deletion, not a guarantee of erasing backups, filesystem snapshots, or provider-side history. See [architecture and recovery](docs/ARCHITECTURE.md).

## Development

[Verification](docs/TESTING.md) describes native smoke tests and isolated data. [Design](docs/DESIGN.md), [decisions](docs/decisions/DECISION-LOG.md), and the [current handoff](docs/handoff/CURRENT-HANDOFF.md) record the first-version scope. `pnpm dev` opens an interface-only web build; durable operations require the desktop app.

The source is public. The project owner has deferred choosing a license; no project license is granted by this repository yet. Dependencies retain their own licenses. No T3 Code source was copied.

The [Claude API connection](docs/CLAUDE-API.md) is authored in the current PR with a protected key/workspace identity, discovered models and text streaming. CI and native UI verification are pending; no live account/inference acceptance is claimed.
