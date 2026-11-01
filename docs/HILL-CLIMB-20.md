# Twenty improvement loops

Dylan authorized 20 loops on 1 November 2026, then a final handback. Owner: Sol. Preserve selected R3-B Open Canvas. No merge/release, host application execution, or withdrawn agent/VM scope. Each loop needs a concrete improvement and relevant passed verification. Related loops can share a CI/native run; authored tests and baseline checks do not count as completed improvements.

**Completed: 7/20** (loops4–10, renderer verification at7ec68a2). Loops1–3 require changed native acceptance/capture proof. Loops11–20 are authored and await CI/native evidence. All20 must be verified on the final candidate before completion. Native acceptance remains open; the original exact navigation assertion is unchanged. Do not mark a visual or native requirement complete from unit tests alone.

| Loop | Improvement                                                                          | Evidence needed                                                                                 | State            |
| ---- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ---------------- |
| 1    | Remove duplicate Chat workspace-back action; retain the single Workflows route       | New renderer regression; unchanged native route assertion must pass                             | authored         |
| 2    | Show workspace page heading once, instead of also repeating it in the header         | Renderer regression; workspace capture inspection                                               | authored         |
| 3    | Offer Connect a model directly in the empty canvas after discovery returns no models | Renderer setup/draft/no-send regression; fresh-profile UI                                       | authored         |
| 4    | Send with no available models opens setup directly rather than an empty picker       | Renderer exact draft/no-send regression                                                         | CI7ec68a2 passed |
| 5    | Preserve missing model identity and its provider icon through discovery loss         | Existing provider removal and picker regressions updated to the actual named unavailable choice | CI7ec68a2 passed |
| 6    | Leave global chat/search shortcuts to IME while composing                            | Renderer composition shortcut regression                                                        | CI7ec68a2 passed |
| 7    | Prevent favourite shortcuts from changing a hidden model behind navigation           | Renderer preserved preference regression                                                        | CI7ec68a2 passed |
| 8    | Return focus to Search chats when its input is closed                                | Renderer focus-return regression                                                                | CI7ec68a2 passed |
| 9    | Repeated Ctrl+K refocuses existing search without clearing it                        | Renderer query/focus preservation regression                                                    | CI7ec68a2 passed |
| 10   | Preserve modal and drawer input on composition Escape; ordinary Escape still closes  | Shared Modal and App regressions                                                                | CI7ec68a2 passed |
| 11   | Preserve model-picker composition on Escape                                          | Renderer plus native composing picker search                                                    | authored         |
| 12   | Explain comparison selection limit rather than silently ignoring the fifth model     | Five-model renderer/native cap and replacement scenario                                         | authored         |
| 13   | Make an empty comparison selection clear and recoverable                             | Renderer/native zero-selection recovery and Done                                                | authored         |
| 14   | Distinguish actual provider error states from a missing connection                   | Native catalog-state source inspection plus provider-row regressions                            | authored         |
| 15   | Explain connected providers with zero available models                               | Renderer/native connected-Ollama-with-zero-models setup                                         | authored         |
| 16   | Normalize accidental outer clipboard whitespace in supported key forms               | Three actual masked form regressions plus native synthetic paste                                | authored         |
| 17   | Guard repeated pending Keep actions and retain retry on failure                      | Deferred Keep failure/retry and single pending request                                          | authored         |
| 18   | Guard overlapping new-chat actions across entry points                               | Deferred new-chat shortcut failure/retry and retained previous draft                            | authored         |
| 19   | Freeze and serialize pending workspace creation; preserve failed edits               | Pending/failure form plus saved-workspace/first-chat partial success recovery                   | authored         |
| 20   | Serialize pending deletion with clear recovery on failure                            | Pending deletion/retry, replacement failure recovery and native confirmation                    | authored         |

The candidate queue can change when direct evidence finds more important friction. The total remains 20; do not pad the count with formatting, documentation, duplicate tests or cleanup operations.

## Baseline and custody

9b26363 passed CI41220483232, artifact13050071337, actual merge/build f21843eac1b4fbeb4bf5fe461962053fd8094ff1. All82 CI source hashes, native context and120 transported file hashes matched. Native run20261101T011258Z-e0a72fd5cf14 passed22 workflows then failed a strict Chat lookup: the Workflows action and workspace-back action both had that exact name. All2reports/21PNGs/two source metadata retained, all21 captures inspected in4 labelled contact sheets. The Lisbon demonstration, final drawer captures, release and performance stages were not reached. Original exit1 remains retained. This is not a passed native baseline; accepted executable stays02bc628.

Installed Lab Manager2.7.0/release20261031-181447 was inspected before new calls; adapter SHA256 D5B24CA7EC0D1C69E13DAC79E72EE7E623F5B1C9425CCCC6E6AC6F9EF92A7520, DLL AF33C0B54B4EB45B0944FF97684558289E91593E102951421899383693E10B5E. New exact candidate session/guards preserve older clients. Queue task task-f8c71ffe48f6462cb1cb1f90d9543140/job-6559abca71b647bc935078eb60a6a13b/reservation-726815627a0442cfba26a24c008b7223 completed its command with unknown cleanup. Supported disposal933b0e13881c4c1bad8eb351c0bca5bd, request pavane-9b26363-disposal-001, returned recovery-busy and sent no guest request, including one supported same-request resume. Retain verification-input and guards until mechanical receipt; no fresh native dispatch or direct cleanup. CI/source work can proceed independently.

Rollback each cohesive batch with its matching tests; stored chats, drafts, instructions, keys and attempts are retained. The independent persisted-retry review from the earlier slice remains open before merge/delivery.

## Batch2 source and batch1 verification

CI7ec68a2/run41260663643/job124713077476 passed109 renderer tests/14files,15helpers,79nativeRust+15storage/all gates. Loops4–10 have relevant renderer proof; loops1–3 still need changed native evidence. The next source batch authors loops11–20 with additional regression/native paths; no new runtime pass is claimed.

Native additions cover an initially empty model service, direct connection and no-model-send recovery, exact draft retention, a fifth-model cap, empty comparison/Done, composing picker Escape, masked synthetic key paste for3forms and confirmed synthetic deletion. Existing assertions/budgets remain. Add native-first-connection.png, native-first-connection-ready.png and native-model-comparison.png to the retained capture set.

Workspace creation now distinguishes a failed creation (retain the editable form) from a saved workspace whose first chat failed (show the saved card for continuation, without creating that workspace again). The previous premature workspace switch is removed. Confirmed deletion closes the dialog/navigation before opening a replacement; replacement failure offers New chat rather than repeating deletion. These are renderer lifecycle guards around existing native APIs, not schema/provider/auth/IPC changes.

Cleanup correction: supported disposal933b0e13881c4c1bad8eb351c0bca5bd completed01:19:13.7715992Z, Boot35→36, with1restart/cleanup and dispatch/process-tree/task-observer/workspace proof. Original unknown/exit1/exited-nonzero is retained separately from cleanupConfirmed=true/aborted-by-reset/reservation retirement. The old transport was moved to its private candidate root only after receipt; old guards/evidence are preserved. No active old command. Future native work requires a fresh authenticated successful CI artifact and manager admission.

This second cohesive batch exceeds500 inserted lines/15files because ten requested interaction loops span shared credential forms, renderer lifecycle, meaningful deferred negatives and the source-bound native fixture. Much of the addition is verification. It does not introduce a second settings system, dependency or domain abstraction. First-batch proof stays attributable to7ec68a2; final acceptance must name the new source and preserve the earlier native failure.

Loop20 source-review refinement: distinguish deletion acknowledgement followed by a list-refresh failure from failure to create a replacement. A dedicated renderer negative verifies the accurate message, one delete, no replacement request for an unrelated current chat, and preserved current draft. This finishes the same deletion loop; it is not an extra loop. New CI/native proof remains pending.
