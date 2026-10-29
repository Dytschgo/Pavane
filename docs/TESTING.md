# Verification on Windows

Use a fresh checkout, Node.js 24+, pnpm 10.34.5, stable MSVC Rust, C++ build tools and WebView2.

```powershell
pnpm install --frozen-lockfile
pnpm check
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
pnpm desktop:build
```

`pnpm test` covers renderer state helpers and affected interaction contracts. Rust storage tests cover durable drafts/reopen, crash interruption, expiry at its exact boundary, Keep, cascading deletion, no resurrection, atomic/bounded parallel runs, terminal-state protection, stable message paging and workspace instruction separation. Native decoder tests cover fragmented UTF-8, final frames and malformed/oversize input. None contacts a remote model.

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

## Data and measurements

Keep all evidence synthetic. Do not commit SQLite files, raw provider logs, tokens or user messages. The executable's size, renderer transfer size and idle process memory are different measurements. Record the build mode, device, process tree and workload before stating any performance number. No regression comparison exists for this new repository.
