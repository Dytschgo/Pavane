# Current handoff — 30 October 2026, 21:45 UTC

Active checkout `D:/Code/Pavane-desktop`, branch `feat/desktop-foundation`, draft [PR1](https://github.com/Dytschgo/Pavane/pull/1) against develop. Retired dirty `D:/Code/Pavane` is preserved; only append coordination facts to its TASKS.md. License deferred, PR unmerged, no public installer/release or paid provider setup.

## Testing boundary

Dylan is working on this PC. Run app tests, builds, benchmarks and UI only through CI/the Windows lab. Local source editing/formatting, read-only review, artifact downloads and file-hash/MCP orchestration are allowed. The old `target/release/pavane.exe` stays unchanged and unlaunched. Guest has Node22.23.3/pnpm11.25.0, no Cargo; use hash-bound CI prebuilt input, not a guest install or host build. Guest Codex login has not been established; baseline excludes LiveCodex. Earlier real local Codex proof predates this boundary.

## Confirmed cause and pending candidate

`PV-CHAT-FOLLOW-001` remains working. The rendered-size/direction repair at6c4e3d7 now passes pinned following and upward reading on the actual lab. History pagination previously passed atedaeea0. Full resume remains red.

Latest diagnostic requested head `545188d1c48286c29490f5551453d13f8abba0c9` passed CI41131633651/job124323728393. Actual merge build `8815c41bb8f868760de6c7cc5bdbddb15b34acd6`, artifact13012813817, ZIP `8f3032772fa92803d58a48b05c24c0e978869fc3ff940ca72d939c5f9b95136b`. All56source hashes matched; source manifest `ee3bb6a260a5c70743eb97fc3b89f00b2f725bb4d3d172490bc458f9b1e44aae`; binary8520704bytes/SHA256 `e7848adb96606dcadf676decd384b30fd852085e4df31f333386123ecb9b8342`.

Actual run `20261030T213849Z-5c0902fd5507` failed at `resume-reach-latest`. Wheel delta10000000 reached conversation at height34718/top14140/viewport511; next scrollTop34207 exactly reached the old bottom, but height was35105 (+387px). Current-gap handling missed the earlier end intent; finalgap81662. Pinnedgap0, composer focus, manualanchor0px during15472px growth, native12/release2 and exact reply/draft reload passed. Four reports/12PNGs retained; long/read/failure inspected. History/resumed following were not accepted by this run. [Full provenance](../VERIFICATION.md), [diagnosis/rollback](../PERFORMANCE.md).

Current candidate adds pre-layout wheel intent: upward unpins; positive pixel-wheel distance reaching the current end enables follow. Native default scrolling remains; zoom/horizontal/default-prevented/portal/nested scrolling excluded. The component regression models growth before the scroll event and negative gestures. Independent read-only review found no material issue. Formatting/diff inspection only locally. CI and the same native input/24px follow/3px reading budgets must pass before a fix claim. Keyboard/touch/non-pixel completeness and CPU/RAM improvement are not claimed. CPU work remains separate PV-PERF-003; providers/swarms/media/installer remain unfinished.

## Lab custody and next run

Installed LabManager2.4.8 `20261030-212752`, sibling `lab-manager.exe` SHA256 `57BE984264B6261287A816131016420550B8D87D19FDFFEA40923EDB4A3F7926`. No maintenance hold or active job/recovery. Job `job-6a15d767c35e4b5c89acad8fcb93b858`, reservation `reservation-ab0b543e6dd4403fb1a7b3011d26079f`, request `pavane-545188d-ui-windows-001`, session `pavane-follow-545188d-001` settled by root recovery `362337d9e8284f6c98326e5bc74fd0b7` at21:43:55.5645044Z: Boot12→13/restart1cleanup1/task-observer-workspace proof. Unknown/exit1 preserved, cleanuptrue/aborted-by-reset, reservation retired. Fresh21:45:12Z probe ready+desktop/statusavailable/noreservation; refresh before future ownership.

Private immutable guards/token/receipt/archive/payload/reports: `%LOCALAPPDATA%/LabManager/pavane-545188d-ui-verification`. Transport input moved out after cleanup. Earlier guards/tokens and `.crabbox/` preserved. Legacy transport remains reusableJobs=false: preserve exact recorded-run evidence before supported plan/recover/get disposal; retired attempts are never replayed/released and ledgers never edited. [Lab contract](../LAB-VERIFICATION.md).

1. Push the candidate, link PR immediately and use the existing persistent watch for CI completion. Check exact requested head and successful run before downloading its artifact.
2. Authenticate artifact ZIP digest, exact two entries, all source and binary hashes; keep actual build merge separate from requested head. The private `pavane-tools/Stage-CiInput.ps1` performs metadata/hash checks only. Stop on any mismatch.
3. Freeze source and create a DISTINCT private client/session/request/guard. Fresh probe must report ready+desktop and exact preflight ready before reservation. Root owns next desktop turn; serialize all checks.
4. Submit once: source `D:\Code\Pavane-desktop`, command `& .\scripts\verify-windows.ps1`, desktop true, timeout1800, exact pavane-windows-verification policy, no LiveCodex/install. Read correlated report/trace/captures and compare unchanged assertions. Accept resume only with further content growth while pinned, then verify pagination remains within budget.
5. Preserve allowlisted synthetic evidence, complete eligible owned supported disposal, verify receipt/status, move exact payload privately, then record actual outcomes. A failed run or cleanup uncertainty stays explicit; no retry under the old guard.
