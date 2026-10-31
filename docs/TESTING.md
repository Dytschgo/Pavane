# Verification on Windows

Latest boundary: Dylan is working on this computer and explicitly stopped local Pavane tests. Do not run app tests, builds, benchmarks or UI automation here. Source editing/formatting and read-only review remain local; CI builds/tests and supported lab desktop jobs provide executable verification. Older local-testing permission below is historical and superseded.

Use a fresh checkout, Node.js 24+, pnpm 10.34.5, stable MSVC Rust, C++ build tools and WebView2.

For a lab without Rust, use the [source-bound prebuilt UI path](PREBUILT-VERIFICATION.md). It runs the real bundled app and records its reduced scope; it does not install a toolchain or replace the source/build gates.

The earlier sleep-time permission was later revoked. Execute the commands below only in CI or an approved lab/build environment, with isolated app data. The [scoped lab plan](LAB-VERIFICATION.md) and exact `& .\scripts\verify-windows.ps1` govern managed native runs. GitHub Windows CI is a separate source/build gate; actual lab cleanup requires its own supported receipt before the next job.

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

`node scripts/performance-smoke.mjs --label candidate` exercises a bundled release with an isolated SQLite/WebView profile, owned CDP9425 and synthetic loopback provider. It warms Markdown, streams300formatted sections while typing only in the composer, checks exact reply/draft reload, then deliberately reads upward during another stream and resumes following through real wheel input while content still grows. It also loads native history across100messages. Budgets cover typing p95/max, pinned/resumed bottom gap and held/prepended paragraph position. `--history-only` is the shorter paging repro; it does not establish streaming behavior. The exact lab wrapper already includes the full fixture serially after native/release checks.

Inspect long/read/history captures and JSON before accepting the result. A timeout preserves phase, bounded synthetic wheel/scroll trace, failure viewport/stack and an allowlisted failure PNG. Do not replace missing active-stream growth with a final scroll or turn a failed wait into a pass. Full source-bound acceptance exists at301cae4; rerun for changed behavior/harness or a new unresolved concern, not an unchanged documentation checkpoint. [Measured proof and limits](PERFORMANCE.md).

The CPU sampler runs only during the second manual-read/resume stream, preserving the unprofiled typing window. Its complete collector produced two0bc99e4, two1804287 and twof2c8f72 captures; the last overall run failed its typing budget despite complete profiling. Actual partial-stop collection remains unexercised. The bounded `cpu-profile-candidate.json` distinguishes capture completeness from the overall test verdict. Two matched memoization observations establish less JavaScript work alongside higher layout and typing p95; total-task ranges overlap. Preserve existing security/table/copy and native interaction/retention checks, report tradeoffs, and compare equivalent windows. Partial/missing data is not a speedup. The rendered-size-only experiment was rejected after its repeat typing-budget failure; preserve the failed result and unchanged budgets. [CPU results and comparison conditions](CPU-PROFILING.md).

Keep all evidence synthetic. Do not commit SQLite files, raw provider logs, tokens or user messages. The executable's size, renderer transfer size and idle process memory are different measurements. Record the build mode, device, process tree and workload before stating any performance number. No regression comparison exists for this new repository.

## Gemini API candidate

The [Gemini API baseline](GEMINI-API.md) passed CI mocks/vault checks and full native verification at942e87a (the earlier signed-timestamp baseline isf93104b). The later offline-reply identity regressions passed CI288547e; that exact Gemini state is not natively verified. Its key is separate per native database profile, unlike shared CLI-owned Codex login. Vault tests use only disposable Credential Manager targets; HTTP fixtures use loopback and synthetic values. The native smoke's new narrow connection check observes an empty key profile and tests masking/invalid input/idempotent removal, without saving a valid key or sending to Google. Do not treat that as live model/account acceptance or run it on Dylan's working PC. Retain native-gemini-connection.png through the verifier's existing finally export. Full key/model sending needs separately recorded account acceptance; no paid development calls or auth transfer are implied.

## Composer composition cancellation

The new IME regression keeps a Japanese draft and active response intact for a composing Escape, then verifies normal Escape stops exactly the selected chat. The changed native cancellation stage dispatches a composition-flagged KeyboardEvent into the owned WebView, requires fresh real mock-provider text growth, then uses ordinary keyboard Escape and checks partial-text/draft retention. It does not configure or drive Windows' actual IME candidate UI. CI 942e87a passed the renderer regression; actual lab 20261031T033906Z-39613f420854 passed the changed native stage among16workflows, with release/history/retention/profile passing too. All checks remain CI/lab-only. [Evidence](VERIFICATION.md#composer-ime-cancellation-accepted--31-october-2026). Existing Stop-button reload coverage and timing budgets stay unchanged.
