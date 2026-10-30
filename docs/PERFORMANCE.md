# Long chat and history measurements

Current boundary: Dylan explicitly stopped local app tests, builds, benchmarks and UI automation while working on this computer. Source editing/formatting and read-only review can continue. Run new verification through Windows CI and the supported Windows lab after LabManager's current maintenance hold ends.

## Verified pagination acceptance

CI run `41122549470` passed requested head `edaeea0efc0ee101dd4b5dbc9ef43d9562dc76ab`, including the App pagination regression. It built actual merge revision `fc941e1f07213238f2ad65db93e8ffa1e373d4c0` and uploaded artifact `13010675758`. Archive SHA-256 `2b726e9fa5446e77fb640c3ac87df4b2820ae7757aabb5ebf14b9cfd28dd3b90`; executable 8,520,704bytes/SHA-256 `7d1cc7f067aecb1586f95dfdc839e512f609e27f8bcbe81cc2f91ed96dcbc311`. All56 source-file hashes matched the frozen checkout before dispatch; manifest SHA-256 `debf5af73fcfe3e91500338f77612b98f4c1f206a8fa8802587cc5c2c1ea9958`. No candidate execution/build occurred on Dylan's computer.

Actual lab run `20261030T203335Z-9bd856deb443` passed:12native workflows,two standalone checks and the full long-stream/history fixture.100→110messages retained the same reading anchor within0.1875px; scrollTop compensated7152px, matching the added history height. The entire71,989byte response and concurrent draft survived SQLite reload exactly.80active-provider keyboard samples: p95host action99.28ms,max117.75ms; long tasks88/max91ms, ScriptDuration11.89s/LayoutDuration2.05s. This is a VM observation with different runtime/build/window conditions from the earlier local baseline; it is not a controlled typing/CPU/memory improvement comparison.

All15allowlisted exports were retained:4JSON reports and11PNG captures, all inspected. The guest ran existing Node22.23.3/pnpm11.25.0; Rust compilation/tests ran in CI, no guest Rust/tool installation or live Codex inference. Guest execution69.5068s,total97.9937s. Source transport recorded77files/SHA-256 `E0C77F4875C2761169DFF427FF19C7882AAE3E79ACFE5AF660118BBC542821EE`, expected dirty state from two untracked transport inputs. Root then completed supported disposal `9b2115c418724e1da3240fcb848a5487` at20:38:53.329717Z, BootId9→10,restart1/cleanup1, task/observer/workspace acknowledgement; fresh20:40:40Zprobe ready/desktop and status available/no reservation. Retained command pass and administrative cleanup remain separate records. Evidence is ignored under `evidence/lab-20261030T203335Z-9bd856deb443`.

## Next focused auto-follow check

The long-response capture still showed early sections after the end marker existed in the document. That warrants a focused viewport-follow repro; it is not a diagnosed cause or completed behavior fix. The next fixture addition records the initial/final bottom gap and focus after two frames. With a fresh chat initially pinned and only composer typing (no wheel/page-up/conversation scrolling), it asserts a24px maximum final gap. This new assertion was added AFTER the successful run above and has not executed yet. CI/lab must establish its result; no local app/tests/builds/UI execution is authorized. Preserve separate coverage for intentionally scrolling upward before changing follow behavior.

## Baseline captured before that boundary

Actual Windows release executable SHA-256 `a1295414bca0583051bb8691ba8c23993223d1c1d2dfa51d02c3d66fd7cc1a26`, unchanged app source from CI-green `78c7816`. Every measurement used a fresh named SQLite profile, separate WebView2 directory and synthetic loopback Ollama-compatible server. No real model inference or normal user database was used. Reports/captures are ignored under `evidence/performance-*`.

`node scripts/performance-smoke.mjs --label baseline-full` streamed 71,989bytes of Markdown:300sections with headings,tables,links and code, one chunk every50ms.95keyboard actions were sampled while the provider was active. The p95 host keyboard-action round trip was66.04ms, maximum71.57ms; renderer long tasks105, maximum82ms; ScriptDuration14.19seconds versus LayoutDuration0.13seconds. The recorded input-to-next-frame approximation is not a field INP measurement. Instrumentation/CDP add overhead; this is one local warm-machine workload, not a general RAM/CPU benchmark or measured speedup. Typed draft and response end marker survived native reload. An earlier run used a wrong history-title selector; it is fixture failure and not application evidence.

The full history case crossed the100-message SQLite page boundary and displaced the same old message by thousands of pixels. A minimized plain-text command completed in four seconds:

```powershell
node scripts/performance-smoke.mjs --label history-baseline --history-only
```

51turns produce102messages. Loading the older pair twice reproduced254px anchor displacement: same DOM message/text, scrollTop0 before/after, scrollHeight+254. The load button was visible at scrollTop0, avoiding automation-induced scroll-to-click. This supports missing prepend compensation rather than Markdown being necessary. Baselines are red on a3px reading-anchor budget; streaming keyboard actions already met the provisional120ms p95/500ms maximum budgets.

## Source repair

At older-page fetch completion, capture the first visible existing message and its position. After React commits the prepended rows, use a layout effect to adjust scrollTop by that same element's displacement before paint. Verify current chat and containment first; already-applied browser anchoring yields zero adjustment. Capture after the await so user scrolling during the fetch is respected. An App regression models prepended geometry through the actual pagination path; it passed in CI and was not run locally after the prohibition. Independent source review found no material issue; actual browser/Markdown geometry passed in the lab as recorded above.

The full fixture checks concurrent draft/full-response SQLite retention, native history paging and a3px maximum reading-anchor displacement. `--history-only` remains the short focused repro. The guest verifier runs the full fixture serially after existing native/release checks and exports `performance-candidate.json` plus long-chat/history captures. It must fail if a budget or retained-content assertion fails; assertions are not waived for a screenshot pass. The new viewport-follow assertion remains a separate pending result.

CI now prepares/uploads only the executable+manifest so no build runs on Dylan's computer. Retain actual CI checkout revision, requested head, run/attempt identity and source/binary hashes separately. The next protected job needs a distinct reservation/request/guard after a fresh probe/preflight; original retired attempts stay immutable. No guest tool installation, policy relaxation, real inference or host auth transfer is part of this pass.

Remaining performance work: identify which JavaScript work dominates the long stream before optimizing Markdown cadence or parsing. The typing result alone does not justify changing provider lifetime or claiming lower memory use. Long tasks and rich-history stability need repeat measurements on the lab after the functional anchor repair passes.
