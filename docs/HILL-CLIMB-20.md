# Twenty improvement loops

Dylan authorized 20 loops on 1 November 2026, then a final handback. Owner: Sol. Preserve selected R3-B Open Canvas. No merge/release, host application execution, or withdrawn agent/VM scope. Each loop needs a concrete improvement and relevant passed verification. Related loops can share a CI/native run; authored tests and baseline checks do not count as completed improvements.

**Completed: 0/20.** First ten improvements are authored and awaiting CI. Native acceptance remains open; the original exact navigation assertion is unchanged. Do not mark a visual or native requirement complete from unit tests alone.

| Loop | Improvement                                                                          | Evidence needed                                                                                 | State    |
| ---- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | -------- |
| 1    | Remove duplicate Chat workspace-back action; retain the single Workflows route       | New renderer regression; unchanged native route assertion must pass                             | authored |
| 2    | Show workspace page heading once, instead of also repeating it in the header         | Renderer regression; workspace capture inspection                                               | authored |
| 3    | Offer Connect a model directly in the empty canvas after discovery returns no models | Renderer setup/draft/no-send regression; fresh-profile UI                                       | authored |
| 4    | Send with no available models opens setup directly rather than an empty picker       | Renderer exact draft/no-send regression                                                         | authored |
| 5    | Preserve missing model identity and its provider icon through discovery loss         | Existing provider removal and picker regressions updated to the actual named unavailable choice | authored |
| 6    | Leave global chat/search shortcuts to IME while composing                            | Renderer composition shortcut regression                                                        | authored |
| 7    | Prevent favourite shortcuts from changing a hidden model behind navigation           | Renderer preserved preference regression                                                        | authored |
| 8    | Return focus to Search chats when its input is closed                                | Renderer focus-return regression                                                                | authored |
| 9    | Repeated Ctrl+K refocuses existing search without clearing it                        | Renderer query/focus preservation regression                                                    | authored |
| 10   | Preserve modal and drawer input on composition Escape; ordinary Escape still closes  | Shared Modal and App regressions                                                                | authored |
| 11   | Preserve model-picker composition on Escape                                          | Candidate; inspect and verify                                                                   | queued   |
| 12   | Explain comparison selection limit rather than silently ignoring the fifth model     | Candidate; inspect and verify                                                                   | queued   |
| 13   | Make an empty comparison selection clear and recoverable                             | Candidate; inspect and verify                                                                   | queued   |
| 14   | Distinguish actual provider error states from a missing connection                   | Candidate; native state values must be inspected                                                | queued   |
| 15   | Explain connected providers with zero available models                               | Candidate; inspect and verify                                                                   | queued   |
| 16   | Normalize accidental outer clipboard whitespace in supported key forms               | Candidate; preserve validation and secret redaction                                             | queued   |
| 17   | Guard repeated pending Keep actions and retain retry on failure                      | Candidate; inspect and verify                                                                   | queued   |
| 18   | Guard overlapping new-chat actions across entry points                               | Candidate; preserve current chat/draft                                                          | queued   |
| 19   | Freeze and serialize pending workspace creation; preserve failed edits               | Candidate; no persistence/schema change                                                         | queued   |
| 20   | Serialize pending deletion with clear recovery on failure                            | Candidate; no deletion or permission bypass                                                     | queued   |

The candidate queue can change when direct evidence finds more important friction. The total remains 20; do not pad the count with formatting, documentation, duplicate tests or cleanup operations.

## Baseline and custody

9b26363 passed CI41220483232, artifact13050071337, actual merge/build f21843eac1b4fbeb4bf5fe461962053fd8094ff1. All82 CI source hashes, native context and120 transported file hashes matched. Native run20261101T011258Z-e0a72fd5cf14 passed22 workflows then failed a strict Chat lookup: the Workflows action and workspace-back action both had that exact name. All2reports/21PNGs/two source metadata retained, all21 captures inspected in4 labelled contact sheets. The Lisbon demonstration, final drawer captures, release and performance stages were not reached. Original exit1 remains retained. This is not a passed native baseline; accepted executable stays02bc628.

Installed Lab Manager2.7.0/release20261031-181447 was inspected before new calls; adapter SHA256 D5B24CA7EC0D1C69E13DAC79E72EE7E623F5B1C9425CCCC6E6AC6F9EF92A7520, DLL AF33C0B54B4EB45B0944FF97684558289E91593E102951421899383693E10B5E. New exact candidate session/guards preserve older clients. Queue task task-f8c71ffe48f6462cb1cb1f90d9543140/job-6559abca71b647bc935078eb60a6a13b/reservation-726815627a0442cfba26a24c008b7223 completed its command with unknown cleanup. Supported disposal933b0e13881c4c1bad8eb351c0bca5bd, request pavane-9b26363-disposal-001, returned recovery-busy and sent no guest request, including one supported same-request resume. Retain verification-input and guards until mechanical receipt; no fresh native dispatch or direct cleanup. CI/source work can proceed independently.

Rollback each cohesive batch with its matching tests; stored chats, drafts, instructions, keys and attempts are retained. The independent persisted-retry review from the earlier slice remains open before merge/delivery.
