# Verification on Windows

Use a fresh checkout, Node.js 24+, pnpm 10.34.5, stable MSVC Rust, C++ build tools and WebView2.

Dylan requires subsequent Pavane builds/tests to run on the lab Windows PC through LabManager. Source editing and formatting can remain on the coding PC. Use [the scoped lab plan](LAB-VERIFICATION.md) and `scripts/verify-windows.ps1`; do not run the commands below on the coding PC or bypass manager policy/reservations. GitHub's Windows CI is a separate source/build gate, not native lab visual acceptance.

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

The fixture needs unused ports 11434 and 9422. Evidence is written under ignored `evidence/`; its JSON reports the synthetic data directory. Debug builds alone accept `PAVANE_DATA_DIR` for isolation. The production binary ignores that environment override. The test opens the desktop app, discovers models, sends and streams UTF-8 text, compares two responses, stops streams, reloads persistent chat/drafts, keeps a temporary chat, creates a bot and checks instructions in the actual HTTP request, and visits all workflows. It then closes its own process and server.

Check native screenshots for wide and narrow windows, long titles, readable status/error text, focus and modal recovery. Exercise keyboard search, menu dismissal and model selection. Do not run an unrelated full browser suite during development. Native fixture results establish the app/IPC/storage/transport contract; they do not prove real provider authentication or inference.

The fixture also captures a focused composer and a long multiline draft. It checks that text does not overlap the toolbar, the send action remains visible, and opening the model picker preserves an unsent draft. Inspect `native-composer-focused.png` and `native-composer-multiline.png` against the reference; geometry checks alone do not establish visual quality.

`node scripts/codex-smoke.mjs` uses a separate temporary database/WebView profile and CDP port 9423. With the guest's existing Codex ChatGPT login it exercises automatic discovery, model/effort/tier controls, favourites across reload, one real Markdown reply, an interrupted second reply and forced app-exit job cleanup. This is live subscription usage; it is separate from the synthetic fixture. `scripts/verify-windows.ps1 -LiveCodex` includes it explicitly. It does not set up a login, transfer credentials or enable provider tools.

## Data and measurements

Keep all evidence synthetic. Do not commit SQLite files, raw provider logs, tokens or user messages. The executable's size, renderer transfer size and idle process memory are different measurements. Record the build mode, device, process tree and workload before stating any performance number. No regression comparison exists for this new repository.
