# Long chat and history measurements

Current boundary: Dylan explicitly stopped local app tests, builds, benchmarks and UI automation while working on this computer. Source editing/formatting and read-only review can continue. Run new verification through Windows CI and the supported Windows lab after LabManager's current maintenance hold ends.

## Baseline captured before that boundary

Actual Windows release executable SHA-256 `a1295414bca0583051bb8691ba8c23993223d1c1d2dfa51d02c3d66fd7cc1a26`, unchanged app source from CI-green `78c7816`. Every measurement used a fresh named SQLite profile, separate WebView2 directory and synthetic loopback Ollama-compatible server. No real model inference or normal user database was used. Reports/captures are ignored under `evidence/performance-*`.

`node scripts/performance-smoke.mjs --label baseline-full` streamed 71,989bytes of Markdown:300sections with headings,tables,links and code, one chunk every50ms.95keyboard actions were sampled while the provider was active. The p95 host keyboard-action round trip was66.04ms, maximum71.57ms; renderer long tasks105, maximum82ms; ScriptDuration14.19seconds versus LayoutDuration0.13seconds. The recorded input-to-next-frame approximation is not a field INP measurement. Instrumentation/CDP add overhead; this is one local warm-machine workload, not a general RAM/CPU benchmark or measured speedup. Typed draft and response end marker survived native reload. An earlier run used a wrong history-title selector; it is fixture failure and not application evidence.

The full history case crossed the100-message SQLite page boundary and displaced the same old message by thousands of pixels. A minimized plain-text command completed in four seconds:

```powershell
node scripts/performance-smoke.mjs --label history-baseline --history-only
```

51turns produce102messages. Loading the older pair twice reproduced254px anchor displacement: same DOM message/text, scrollTop0 before/after, scrollHeight+254. The load button was visible at scrollTop0, avoiding automation-induced scroll-to-click. This supports missing prepend compensation rather than Markdown being necessary. Baselines are red on a3px reading-anchor budget; streaming keyboard actions already met the provisional120ms p95/500ms maximum budgets.

## Source repair and pending proof

At older-page fetch completion, capture the first visible existing message and its position. After React commits the prepended rows, use a layout effect to adjust scrollTop by that same element's displacement before paint. Verify current chat and containment first; already-applied browser anchoring yields zero adjustment. Capture after the await so user scrolling during the fetch is respected. An App regression models prepended geometry through the actual pagination path; it was authored after local tests were prohibited and has not been run locally. Independent source review found no material issue; actual browser/Markdown geometry remains a lab gate.

The full fixture checks concurrent draft/full-response SQLite retention, native history paging and a3px maximum reading-anchor displacement. `--history-only` remains the short focused repro. The guest verifier runs the full fixture serially after existing native/release checks and exports `performance-candidate.json` plus long-chat/history captures. It must fail if a budget or retained-content assertion fails; assertions are not waived for a screenshot pass. Current source is unverified until CI and the lab actually pass.

CI now prepares/uploads only the executable+manifest so no build runs on Dylan's computer. Retain actual CI checkout revision, requested head, run/attempt identity and source/binary hashes separately. The next protected job needs a distinct reservation/request/guard after a fresh probe/preflight; original retired attempts stay immutable. No guest tool installation, policy relaxation, real inference or host auth transfer is part of this pass.

Remaining performance work: identify which JavaScript work dominates the long stream before optimizing Markdown cadence or parsing. The typing result alone does not justify changing provider lifetime or claiming lower memory use. Long tasks and rich-history stability need repeat measurements on the lab after the functional anchor repair passes.
