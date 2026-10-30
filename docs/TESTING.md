# Verification on Windows

Use a fresh checkout, Node.js 24+, pnpm 10.34.5, stable MSVC Rust, C++ build tools and WebView2.

On 30 October 2026 Dylan explicitly permitted Pavane testing on this computer while he sleeps. This supersedes the earlier lab-only restriction for Pavane. Keep app data isolated and use the lab for specifically coordinated LabManager verification requests. This does not authorize local LabManager builds/tests or bypass its unresolved job fence. The [scoped lab plan](LAB-VERIFICATION.md) and exact `& .\scripts\verify-windows.ps1` remain available for supported future guest execution. GitHub Windows CI is a separate source/build gate.

```powershell
pnpm install --frozen-lockfile
pnpm check
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
pnpm desktop:build
```

`pnpm test` covers renderer state helpers and affected interaction contracts. Rust storage tests cover durable drafts/reopen, crash interruption, expiry at its exact boundary, Keep, cascading deletion, no resurrection, atomic/bounded parallel runs, terminal-state protection, stable message paging and workspace instruction separation. Native decoder tests cover fragmented UTF-8, final frames and malformed/oversize input. None contacts a remote model.

Codex protocol regressions use synthetic Node children to cover inherited integration overrides, bounded blocked writes/replies, startup/shutdown ownership, cancelled/queued thread replies, server-request ID collisions, quota parsing, Windows job teardown and rejected-turn isolation. The ignored `live_codex_subscription_roundtrip` test performs one synthetic real subscription inference only when explicitly selected and a guest login already exists. Never copy host auth into the guest.

## Native smoke

The targeted smoke test drives the actual Windows debug executable through WebView2 CDP using `playwright-core`. It starts a synthetic Ollama-compatible loopback server; it never performs inference. It uses a newly created temporary directory and does not touch your normal database. A busy port aborts the fixture rather than stopping an existing service.

In one terminal:

```powershell
pnpm dev
```

In another:

```powershell
cargo build -p pavane --locked
node scripts/native-smoke.mjs
```

The fixture needs unused ports 11434 and 9422. Evidence is written under ignored `evidence/` (or `PAVANE_EVIDENCE_DIR`); JSON reports the synthetic directory, source/lockfile manifest, executable hash and toolchain. Debug builds alone accept `PAVANE_DATA_DIR`; release ignores it. The test opens the app, checks oversized Unicode feedback without truncation, streams UTF-8 text, compares/stops responses, reloads persistent chat/drafts, keeps a temporary chat, creates a bot and checks instructions in the actual HTTP request, and visits all workflows. It closes only its own app and server. Reports start as running and become passed/failed; an old pass must not substitute for the current exit status.

Check native screenshots for wide and narrow windows, long titles, readable status/error text, focus and modal recovery. Exercise keyboard search, menu dismissal and model selection. Do not run an unrelated full browser suite during development. Native fixture results establish the app/IPC/storage/transport contract; they do not prove real provider authentication or inference.

The fixture also captures a focused composer and a long multiline draft. It checks that text does not overlap the toolbar, the send action remains visible, and opening the model picker preserves an unsent draft. Inspect `native-composer-focused.png` and `native-composer-multiline.png` against the reference; geometry checks alone do not establish visual quality.

`node scripts/codex-smoke.mjs` uses a separate temporary database/WebView profile and CDP port 9423. With the guest's existing Codex ChatGPT login it exercises automatic discovery, model/effort/tier controls, favourites across reload, one real Markdown reply, an interrupted second reply and forced app-exit job cleanup. This is live subscription usage; it is separate from the synthetic fixture. `scripts/verify-windows.ps1 -LiveCodex` includes it explicitly. It does not set up a login, transfer credentials or enable provider tools.

`node scripts/codex-smoke.mjs --release` exercises the same live flow in the freshly built optimized executable, using an explicit unique database profile and separate WebView directory. Its report records the actual profile/database directory. It needs no Vite server; never substitute a stale production executable for the documented fresh build.

## Bundled release and profiles

Build the current source before release verification. The release fixture uses `--profile verify-<UUID>` to select a separate SQLite/Codex workspace under `%LOCALAPPDATA%/cloud.pavane.desktop/profiles/NAME`; it supplies a separate temporary WebView2 directory. It never uses the normal database. Keep port 9424 unused and run fixtures serially. Stop the Vite process you started before this check to prove the bundle is independent:

```powershell
pnpm desktop:build
node scripts/release-smoke.mjs
```

This checks the actual `tauri.localhost` bundled renderer, all routes and durable draft reload, then records three warm-machine launches and owned process-tree memory samples five seconds after discovery settles. It performs no inference. `release-smoke.json` includes every generated profile/WebView directory even on failure, plus the executable/source provenance. Inspect `release-empty.png` and `release-draft.png`. Profiles intentionally retain synthetic data for diagnosis; delete only identified fixture directories during an authorized cleanup.

The optional `--profile NAME` database selection works in both builds. Names use 1–64 ASCII letters, numbers, hyphens or underscores. Invalid arguments or unwritable directories fail startup without falling back to normal data. Windows names are case-insensitive. This is database selection, not a filesystem sandbox or separate provider account: existing Codex credentials and configuration remain CLI-owned/shared. Ordinary WebView preferences remain shared unless a separate `WEBVIEW2_USER_DATA_FOLDER` is supplied. Normal launch keeps the existing database; debug-only environment behavior is unchanged.

## Data and measurements

Keep all evidence synthetic. Do not commit SQLite files, raw provider logs, tokens or user messages. The executable's size, renderer transfer size and idle process memory are different measurements. Record the build mode, device, process tree and workload before stating any performance number. No regression comparison exists for this new repository.
