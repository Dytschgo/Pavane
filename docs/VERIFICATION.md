# Foundation verification — 29 October 2026

This is a chronological evidence record. Earlier results apply only to their recorded revision; the latest checkpoint is at the end.

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

## Codex/chat hill climb — candidate 5473ce0

The sections above record the earlier foundation. Its published PR head `868ca64` passed the single Windows CI check. They do not establish verification of the newer candidate or describe its Codex capabilities.

Candidate `5473ce01315ad95f5741e64fa6268ed98fc12cbc` adds the official Codex app-server bridge, actual model/reasoning/tier/limit discovery, persisted picker preferences, safe Markdown/code rendering and a composer correction based on live T3 Chat inspection. The bridge, its process-lifetime fixes and UI belong to one usable chat flow; the larger source/lockfile diff is cohesive across native transport and renderer. No database schema changed and no T3 source was copied.

Before Dylan required lab-only testing, these checks ran on the coding PC:

- Twelve renderer tests and nine core storage tests passed on earlier hill-climb source. The latest delayed-discovery test and composer changes were not part of that result.
- At native candidate `62077a1`, clippy and twelve native tests passed, with one live test ignored by default. An explicit real subscription round trip with GPT-6.1-Sol passed after fixing buffered Windows launcher input. The gate echo probe reproduced the lost first request before the fix and preserved it afterward.
- Real native UI exercised discovery, reasoning/service-tier controls, favourites across reload and a streamed Markdown/code reply. The later full Codex smoke did **not** pass: after reload it attempted a second send before discovery completed and opened the picker. Startup-send guarding and the smoke readiness wait were corrected in source, but the final interrupt/forced-exit sequence has not been rerun.
- Earlier native mock-provider smoke passed before the latest launcher/UI corrections. It is not a final-candidate pass.

Three independent native review passes found startup ownership, bounded-write/reconnect, cancelled/queued reply cleanup and Windows launch-containment defects. The reviewer accepted the gated/unbuffered launcher and thread-response lease at `62077a1`, then found rejected turn startup could terminate sibling chats. `cca379c` fixes that and adds a synthetic regression; execution is pending. Read-only Claude UI advice informed the first picker/chat revision. Dylan subsequently rejected the older shipped composer screenshot, and root inspected live T3 Chat plus local T3 Code composer structure before the source correction.

After the lab-only instruction, no further local app tests/builds were run. Formatters updated source, and `git diff --check` found no whitespace errors. The focused/multiline screenshots and geometry/draft-preservation regressions are prepared in the native fixture; **they have not yet been produced for this candidate**. Final format/lint/types/tests, native visual/interaction checks, live Codex cancellation/containment and the optimized executable remain pending on the lab. See [the lab gate and exact plan](LAB-VERIFICATION.md).

The existing `target/release/pavane.exe` remains the old foundation build. Do not tell the user it contains the new Codex/chat changes. No final RAM/startup measurement exists for this candidate, and no updated binary has been launched or published. License remains deferred; PR #1 remains unmerged.

## Windows CI and failed lab attempt — d2917ee

GitHub Windows CI passed on `d2917eedf057067e7d3688a5eddc30916dc76c6e`, run `40957427918`, job `123741024047`, completed 2026-10-29T21:32:41Z. It covers formatting, lint, TypeScript, renderer tests, Rust formatting/clippy/tests and the optimized Windows build. It does not establish native UI, live subscription cancellation or Windows descendant-cleanup acceptance.

The one lab attempt for that head failed in retained-runner host source hashing (`Get-FileHash` unavailable), exit 1. Recorded run `windows-test/20261029T221740Z-00bce28e941c` has no Pavane verifier report or screenshots. Its managed job remains unknown with cleanupConfirmed=false. LabManager's subsequently installed 2.4.1 launch fix and root's successful read-only MCP checks do not reconcile that historical job. See [the exact lab gate](LAB-VERIFICATION.md); no retry/release is authorized from these observations.

## Chat interaction pass — PV-CHAT-UX-003

Source changes address stale picker search/highlight state, keyboard navigation scrolling, provider-scoped search, IME-safe selection, favourite shortcuts and supported model-option fallback shared by display/submission. Active non-default service tier is visible on the trigger. No provider, schema or credential boundary changed.

An independent read-only source review identified four adjacent defects: streaming table wrappers remounted, code copy feedback outlived its snapshot, asynchronous send completion could steal search focus, and background errors lacked the originating chat. Source fixes keep Markdown component identity stable, share bounded clipboard feedback, respect current focus/chat ownership, and label errors with their chat/model. Added regressions exercise these behaviors and picker flows. They are not claimed as passed before CI execution.

At this checkpoint only source formatting and `git diff --check` ran on the coding PC. Renderer tests, lint/types and the build for this pass await Windows CI. Native visual/interaction and final live Codex checks remain blocked by supported reconciliation. No current screenshot, RAM measurement or executable acceptance is claimed. The changes form one coherent chat workflow pass, with most additions devoted to behavioral regressions. Reverting the commit restores prior interaction behavior without a SQLite migration.

Windows CI on `081700d` passed formatting and lint, then stopped in TypeScript: two new role queries used an unsupported `exact` option. String accessible-name queries already match exactly. The follow-up removes that option without weakening the assertions or changing app behavior. Renderer execution and the build were not reached; the corrected candidate needs its own CI result.
