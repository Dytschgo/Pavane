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

## Overnight native hill climb — 30 October 2026

Dylan explicitly permitted local Pavane tests/builds while he sleeps, superseding the earlier lab-only restriction for this app. The baseline `f0885a6` passed all Windows CI checks in run `40972253734`, job `123791592323`: 24 renderer tests, 13 native tests, nine core tests and optimized build. One live native test was ignored by default. The results below apply to the subsequent WIP source, correlated through each report's source manifest and binary hash; they do not clear the LabManager incident.

### Fixes and checks

- `pnpm check` passed format, lint, TypeScript and all 31 renderer tests. A deterministic post-response test first reproduced blocked sending during quota discovery, then passed with background refresh kept separate from initial discovery. Two further picker cases distinguish pending discovery from a genuinely unavailable saved selection; accessible labels match the visible state.
- The slow-save draft workload (16 KiB initial text, 200 edits held behind one unresolved save) first made 201 `saveDraft` calls, then two after coalescing. This is a controlled renderer regression, not a measured end-to-end typing or SQLite speedup. The latest snapshot, failure cache, exact-version acknowledgement and queue-finalizer/multi-chat cases pass. Oversized Unicode text is kept intact in this window with explicit feedback; shortening resumes persistence.
- Rust formatting, clippy and all 24 Rust tests passed (15 native/profile tests and nine core tests; one live unit test ignored). Profile tests cover default behavior, release ignoring the debug override, explicit selection and malformed/path/oversize arguments failing without fallback.
- `node scripts/native-smoke.mjs` passed all 12 actual native workflows after the changes. Focused/multiline composer, wide/narrow chat and Unicode-limit captures were inspected.
- `node scripts/codex-smoke.mjs` and the final `--release` variant passed all eight checks with existing Codex CLI 0.165.0 login: actual model/effort/tier discovery, favourites/reload, real GPT-6.1-Sol Markdown, reload persistence, interrupted partial output and hard-exit provider job cleanup. The fixture initially completed its checks but exited unsuccessfully by waiting twice for a signal-terminated child; checking both exit/signal status fixed the teardown. Both complete commands then exited 0. The optimized variant used a fresh named database profile. No auth files were copied or global Codex settings changed.
- Independent read-only performance, draft-persistence and profile-isolation reviews informed these fixes. The two implementation reviews found no material correctness issue. The profile reviewer’s low finding (unrecorded fixture directories) was corrected before the release check. No schema changed.

### Exact standalone and measurements

`pnpm desktop:build` produced `target/release/pavane.exe`, **8,567,296 bytes**, SHA-256 **`878d2cbe881981fd6f7a9c2f97843aefc3fe827e43a746dfccc25ef0d052ce07`**. The first build attempt could not replace the old running foundation executable. Its known idle instance was inspected and closed gracefully, preserving saved data; the current build then succeeded. The updated executable contains Codex and the refined chat.

With Vite stopped, `node scripts/release-smoke.mjs` passed bundled `tauri.localhost` routing, all six destinations and SQLite draft reload using explicit fresh database profiles and temporary WebView directories. Its first attempt exposed delayed WebView debugging-port release between launches. The fixture now waits for the actual owned listener to disappear, without stopping any process by port; all three serial launches then passed.

| Warm-machine sample | Composer ready | Discovery settled | Process-tree private memory | Aggregate working set |
| ------------------- | -------------: | ----------------: | --------------------------: | --------------------: |
| 1                   |         474 ms |           2847 ms |                   235.5 MiB |             533.9 MiB |
| 2                   |         593 ms |           2962 ms |                   243.8 MiB |             533.4 MiB |
| 3                   |         543 ms |           2900 ms |                   232.7 MiB |             531.7 MiB |

Samples include ten owned processes: app, WebView2 and Codex infrastructure. Each uses a fresh SQLite/WebView profile on a warm Windows machine; memory is sampled five seconds after discovery, with CDP enabled and no inference. Startup includes automation attachment. Working-set totals can count shared pages more than once. This is an idle baseline, not cold-start, peak-load, a historical comparison or proof of the low-RAM goal. Long streaming Markdown and large histories still need profiling before further rendering/process-lifetime changes.

Ignored local reports/captures: `native-smoke.json`, `codex-smoke.json`, `release-smoke.json`, composer/chat/picker/Unicode screenshots, `release-empty.png` and `release-draft.png`. Reports include source/lockfile/executable hashes, toolchain and generated fixture ownership. Source manifests describe source at run time; they are not inferred build receipts. The verifier exports the same allowlisted synthetic evidence on failure/finally. The updated Vite watcher excludes Rust outputs and fixture evidence after observed locked-file watcher errors during builds.

No installer, signing, published release, merge, license choice, API-key provisioning or new lab job. LabManager's original unknown job/token/guard and genuine-human-attestation gate remain untouched. The reviewed 2.4.3 maintenance request needs its own approval; local Pavane success is not lab readiness.

The combined lab verifier's new release stage and PowerShell syntax were checked in source; the individual app commands above ran locally. Combined execution/export inside the guest remains pending. Changes are split into a chat/draft commit and a native-profile/verification commit; the latter keeps startup isolation, its negative tests and the release evidence path together.

## Prebuilt UI acceptance on the lab — 30 October 2026

The guest prerequisite failure was resolved without installing Rust or changing policy. A later intermediate run proved the source/binary input transfer but stopped before UI because the verifier retained an overstrict Node-24 build requirement. The corrected UI-only path supports Node 22.16+ and was exercised locally with the exact guest Node 22.23.3/pnpm 11.25.0 before dispatch. Source builds still use Node 24+. Corepack/pnpm auto-download and install scripts are disabled only for the UI dependency restore; original process settings are restored. No global config or host auth was transferred.

- Exact tested source: `3f82cde87d64a8aac962cd0ffba8ded2a278e195`; branch `feat/desktop-foundation`. Application/native/provider/schema files are unchanged from CI-green `cd8a61c` in this pass; changes concern verification and records.
- Local preparation ran fixed `pnpm desktop:build` with clean tracked source, rejecting source changes during build. Executable: 8,567,296 bytes, SHA-256 `a1295414bca0583051bb8691ba8c23993223d1c1d2dfa51d02c3d66fd7cc1a26`. This is a source-bound build, not a bit-for-bit reproducibility or signing claim.
- Prebuilt source manifest: 55 source/harness/asset/config/lock files, SHA-256 `7da0fe3fd2a247a0bea222cf956d74a71d8e21c822cdff836cd587b16689f374`. Two untracked transport inputs were intentionally included; no binary was staged/committed. Host source manifest recorded 75 files, SHA-256 `738693BACE04AAB9FC53FD6499870BCD18CB145B44F7B75B678E2D178964F659`, dirty=true because of those inputs. Guest hash checks confirm the app/harness/asset bytes actually received, beyond host metadata alone.
- Local proof: format/lint/types and 31 renderer tests passed; three new integrity checks reject altered binary/source, unsafe/duplicate/missing manifest entries and work without Git/Rust. Full verifier passed in a temporary copy without Git metadata/Cargo on Node 24/pnpm 10, then again on Node 22.23.3/pnpm 11.25.0. An occupied CDP9422 refused launch/attachment and preserved its listener; altered source failed before UI and exported failure evidence through the actual finally path. Independent review's endpoint-ownership and unsupported-test-claim findings were fixed; preparation also rejects dirty/untracked application source. No new app Rust behavior was introduced; prior 24-test Rust result remains separate from this UI pass.
- Actual lab job `job-bd50e805a2424c37971c1c2c9195df42`; request `pavane-3f82cde-ui-windows-001`; retained run `20261030T185029Z-544145d70218`. Exact `& .\scripts\verify-windows.ps1`, desktop=true,1800 seconds. Exit 0; 54.3046 seconds guest execution,82.2780 seconds total.
- Guest `verification.json`, `native-smoke.json` and `release-smoke.json` all passed and match the source/executable hashes. Actual runtime Node22.23.3,pnpm11.25.0. Twelve native checks cover UTF-8 streaming/persistence, normal/30-day retention controls, parallel comparison/cancellation, reload/Stop recovery, drafts/restart, bot instructions, search, six routes, narrow layout, reduced-motion dismissal, multiline composer and byte-limit feedback. Two release checks cover bundled routing/draft persistence and three isolated launch/process-tree samples. These are synthetic mock-provider workflows; no guest Codex inference or Rust build/tests. Earlier local real Codex eight-check acceptance is separate and its application code remains unchanged.
- All 12 allowlisted exports were fetched through real MCP run artifacts: three JSON reports and nine PNGs. Root inspected all nine: native empty/chat/final, focused/multiline composer,narrow,Unicode warning and release empty/draft. Baseline actual guest window was1028×749, narrowed to720×620. Layout/actions remain usable in these captures; this is not comprehensive zoom/touch/accessibility coverage. Stderr616bytes contained only PowerShell CLIXML module-preparation progress; no zero-stderr claim.
- After retaining proof, supported disposal `f4071f7e110b49efa56c0e0a5f8aa042` completed18:54:21.8745916Z, BootId8→9,restart1/cleanup1, task/observer/workspace acknowledgement. Run remains passed/exit0. Manager preserves unknown/exit0 with cleanupConfirmed=true and separate aborted-by-reset disposition; reservation retired. Fresh18:55:32Zprobe ready+desktop/statusavailable,no reservation. No raw ledger change,old release,retry or token transfer. Prior failed attempts retain their outcomes.

Synthetic report/capture copies: ignored `evidence/lab-20261030T185029Z-544145d70218`. Private receipts/manifests/tokens stay outside the checkout; transport payload was moved into private retention after cleanup. No installer/signing/public release, new provider parity, swarm, image/video generation or large-history performance target is established by this result. New Windows CI still needs the pushed candidate's own result; documentation-only successors do not rewrite the captured revision.
