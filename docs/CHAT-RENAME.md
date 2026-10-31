# Chat title save guard

PV-CHAT-RENAME-001 is a source checkpoint on PR #1; CI and native acceptance are pending. Source inspection found the old form allowed repeated writes and dismissal while a rename was unresolved. Distinct title writes could resolve out of order; a late completion could also close a subsequently opened dialog. This is a source-supported race, not a measured native reproduction.

The keyed chat rename dialog now admits one pending write through a synchronous guard. Editing, Save, Cancel, Escape, outside dismissal and Close are disabled until the native write settles. The submitted trimmed title is the only title reported to the parent after success; the parent updates the matching sidebar/header and refreshes. Blank titles cannot submit. Existing 120-character input/native limits are unchanged. This guard covers one dialog in this renderer, not competing processes or database compare-and-swap.

A rejected write keeps the dialog, input and inline error available. The user may correct, explicitly retry or cancel after failure. A refresh failure after a committed rename still uses the existing global error path; it does not classify the write as failed. No schema, native command, provider, dependency or credential change.

Three deferred-promise renderer cases cover duplicate submit, pending controls/dismissal, committed-title reporting, retained failure/retry and blank-title/cancel behavior. The changed native stage uses the existing synthetic chat: reject blank Save, Cancel an edit, reopen to the unchanged title, submit a trimmed Unicode title by Enter, then reload and observe the renamed sidebar, exact draft and saved reply without another provider request. It exports native-chat-rename.png through the verifier finally allowlist. Pending-write timing and failure are covered by renderer tests; the native stage does not inject a storage failure.

Only source edits, formatting and diff inspection run on the working PC. CI must compile/test/build the exact candidate; one new authenticated CI-bound lab turn must exercise the changed stage and retain reports/captures before native acceptance. Preserve the accepted 7450713 executable and all previous negative evidence. The private collector's native-* pattern includes the new capture; confirm this before dispatch. No existing lab reservation, guard or token was used.

Rollback restores the previous inline form and removes the new dialog/test/native stage. Already saved titles remain; undo one by renaming again. No data migration, deletion or release is involved.
