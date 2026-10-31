# Reuse an earlier prompt

PV-CHAT-REUSE-001 adds an icon action beside Copy under nonempty user messages. Its accessible name and tooltip are **Add prompt to draft**. Source is authored against CI-green f8af386; renderer regressions and changed native acceptance are pending. Latest tested executable remains0cf7e4f.

## Behavior

With an empty draft, reuse inserts the original prompt. With existing text, it appends two newlines and the original prompt, retaining the existing text exactly. Focus returns to the composer. The user can edit the text and choose models before sending normally. Reuse never submits, changes prior messages, changes model choices or creates a provider request.

The existing 64 KiB UTF-8 draft bound applies to the combined text. Overflow leaves the current editor and saved draft untouched and reports a useful error. A successful reuse clears that particular error; unrelated errors remain visible. Loading/submission disables the action. The callback rejects stale-chat messages, non-user messages and unavailable/disabled editors. Active streams still permit preparing the next draft.

Reuse calls the existing draft writer/cache/version path; it introduces no persistence method, schema, native command or provider behavior. Stable callbacks preserve memoized message rendering while typing. The action row uses the existing buttons, focus states and tooltips: mouse hover or keyboard focus reveals it on fine pointers; other pointers retain visible controls.

## Verification and recovery

Authored renderer cases cover empty/existing Unicode drafts, current model/history preservation, no implicit send, byte-limit rejection/recovery and action visibility/disabled state while retaining Copy. No local tests/builds/UI were executed. CI must establish compilation and regressions.

The changed serialized native stage uses an earlier real synthetic-profile user message: keyboard reuse into an empty draft, append to a distinct draft, native save completion followed by reload and exact restored value. It checks no extra provider request, narrow overflow and rejects a valid multibyte draft whose combination exceeds the existing byte limit. It exports native-prompt-reuse.png through the verifier's finally path. Actual results and visual inspection await one new source-bound CI artifact/lab turn; planned coverage is not a pass.

Existing draft-save failures retain the in-memory version/cache and expose the existing error. Overflow never truncates text. Code rollback removes the action and restores the previous single Copy layout without migrating/deleting SQLite data or altering already saved drafts. No auth, paid inference, host application execution or release change.
