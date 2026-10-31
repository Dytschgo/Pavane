# Open Canvas implementation

PV-UX-CANVAS-001, 31 October 2026. Dylan selected R2-B / Open Canvas, then refined it to **R3-B / Open Canvas — Deep Charcoal** and authorized implementation. This supersedes the prior Quiet Sidebar recommendation. The [approved visual direction](design/open-canvas-reference.png) is an original ChatGPT Image concept edited from R2-B, not an application screenshot or an exact T3 palette. Original prompts and Opus advice are retained in ignored evidence/design-exploration-2026-10-31-r2/ and r3/.

## Result and preserved behavior

The conversation occupies the window. Chats opens one modal drawer for history, search, Projects, Spaces, Bots and Connections. One list contains permanent and temporary chats, with expiry markers and existing rename/delete menus. Creating a temporary chat discloses deletion after 30 days. Ordinary chats remain permanent; the current temporary chat has one header notice and Keep action. No retention or storage policy changes.

The composer keeps model choice at its left and send/stop at its right. Reasoning, service tiers, favourites, compare, unavailable selections and no-fallback remain in the existing picker/native boundary. Empty chats center the heading/composer. Replies use quiet charcoal cards; long Markdown, code/table scrolling, Copy/reuse, per-response Stop and Try again remain. The header exposes workspace editing when relevant. Save state is available to assistive technology without permanent footer copy; save failure shows Retry save beside its explanation.

Ctrl+K opens drawer search; Tab stays in the drawer, Escape closes it and returns focus. Picking a chat closes it and focuses the available composer after loading. Connections returns focus to Chats because its former drawer trigger has unmounted. Existing IME behavior is unchanged. No provider/auth/schema/IPC/dependency changes.

## Verification and limits

Source checkpoint only; changed CI and source-bound native acceptance are pending. No application tests, builds, UI, provider or vault calls ran on the working PC. Formatting and diff review are the local checks. The earlier 02bc628 native build remains the accepted executable until this candidate passes.

Three new renderer cases cover drawer dismissal/focus/draft retention, direct search and one temporary row, and explicit temporary creation. Existing affected tests open the actual drawer before navigation; they retain their draft/provider/expiry negatives. Native helpers follow the same visible path, rather than querying hidden navigation. Existing save-state assertions read the accessible output; they still require authoritative acknowledgement.

The existing native loopback workflow now adds a short Lisbon demonstration, desktop and 480px drawer/canvas captures, model-left/send-right, Ctrl+K focus, Tab containment, Escape focus return and no-navigation-send checks. All previous retry/reload, retained partial/draft, Stop sibling, workspace editing, comparison, expiry and performance budgets remain. New artifacts: native-open-canvas.png, native-navigation.png, native-navigation-narrow.png, native-open-canvas-narrow.png. These must be collected and inspected along with all changed captures. No live cloud inference claim.

The generator's approximate borders, font sizes and texture are adapted to reusable OKLCH tokens and native text. Header labels wrap and truncate safely at narrow widths; the drawer stays modal at every width. No bitmap is used as application UI. This is a cohesive change exceeding 500 inserted lines because modal focus, navigation callers, regression tests and native selectors must change together; much of App's diff is indentation under the shared Dialog root.

## Failure behavior and rollback

Navigation alone sends nothing and does not clear the current draft. Failed sends/saves/discovery keep their existing recovery controls. Expired chats still clear their content; deletion still requires confirmation. The UI does not promise arbitrary automatic repair.

Rollback reverts layout/components/tokens and their matching test/native selectors together. Saved keys, chats, replies, drafts and appended retry attempts remain; there is no migration or data deletion. Keep PR #1 unmerged. Independent persisted-retry review from the previous slice remains open before merge/delivery. Runtime/visual results must be recorded against the actual candidate before declaring this implementation verified.
