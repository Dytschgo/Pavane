# Foundation verification — 29 October 2026

Runtime candidate: `7048c9195a976ed045dd2202f82d11483c418307`. Later changes strengthen the deferred-read regression and document evidence; they do not change runtime behavior. Base: `46aaf8493dba4e8bc0f5f40ef5e46abfcef488c8`. Environment: Windows x64, PowerShell 7.6.9, Rust 1.95.0, Node 24.18.0 and pnpm 10.34.5.

## Executed checks

- `pnpm check`: formatting, lint, TypeScript and seven renderer tests passed.
- `cargo fmt --all --check` and `cargo clippy --workspace --all-targets --locked -- -D warnings`: passed.
- `cargo test --workspace --locked`: nine storage/recovery tests and two stream decoder tests passed.
- `pnpm desktop:build`: optimized Windows executable built successfully.
- `node scripts/native-smoke.mjs`: actual debug Windows WebView, isolated temporary SQLite database, synthetic loopback Ollama-compatible server. Passed model discovery, UTF-8 streaming, parallel responses, cancellation with partial text, reload while streaming followed by Stop, draft/history reload, Keep, bot context in the native HTTP request, six workflow destinations, keyboard search, narrow 720×620 WebView layout, reduced-motion modal dismissal and full native process restart recovery. No renderer errors were observed.
- Release launch: bundled `http://tauri.localhost/` loaded, native SQLite startup succeeded, and navigation worked independently of the development server. No model request was made.
- Tracked-source credential-pattern scan found no matches; no SQLite databases, auth files or `.env` files are tracked. Local Markdown links and whitespace were checked before PR creation.

Ignored local evidence: `evidence/native-smoke.json`, `native-empty.png`, `native-chat.png`, `native-final.png`, `native-narrow.png`, `release-check.json` and `release-empty.png`. The 1360×900 and narrow captures were inspected. The smoke fixture contains only synthetic conversations. This is targeted native verification, not a real provider-inference test.

## Independent review

An independent Sol reviewer inspected `5ec6b2c` and found two P1 issues (second-process recovery and in-flight reload status) and two P2 issues (draft acknowledgement/failure and selected-chat expiry after paging). Those were corrected in `ed8b5eb` with targeted regressions.

A fresh independent Sol reviewer inspected `ed8b5eb` and `21e7486`, accepted those corrections and found an expired-selection loading race. It was fixed; the regression was then tightened to defer the failed read until after expiry clears selection. The reviewer found no other runtime defects in that targeted scope. `7048c9` additionally prevents accepting a draft without a persisted chat. Final renderer tests and native smoke passed after these changes. Review did not establish unimplemented provider authentication, autonomous-agent safety, installer behavior or cross-platform compatibility.

## First performance sample

The release executable is **8,185,856 bytes** (7.81 MiB), SHA-256 `371a46620b9a718aad11d4910465281e70257808ce0699afefa0937a37e7b16a`. Renderer JavaScript is approximately 361 kB / 113 kB gzip; CSS approximately 22.7 kB / 4.9 kB gzip.

One warm-machine release launch reached automation-ready composer state in 555 ms, including CDP attachment. A single process-tree sample immediately after launch/navigation, with no inference, reported about 384 MiB aggregate working set and 209 MiB private bytes across Pavane and six WebView2 processes. Pavane's own process was about 35.8 MiB working set. Aggregate working sets can double-count shared pages; this is not a steady-state idle, cold-start, peak-load or comparative benchmark. Debugging was enabled for automation. The current full-process footprint needs profiling against Dylan's low-RAM goal; executable size alone does not establish that goal.

## Delivery limits

This is an unsigned standalone development executable and a reviewable source PR. CI results are separate from local checks and must be read from GitHub. There is no installer, published release, merge or deployment. Only local Ollama inference is implemented; subscription bridges, provider limit reporting, autonomous swarms, attachments and media generation remain explicit follow-ups. Licensing is deferred by the project owner.
