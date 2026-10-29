# Pavane desktop design

The accepted reference is Dylan's three-column sketch supplied on 29 October 2026 and the [shadcn/ui component language](https://ui.shadcn.com/docs/components). This supersedes the retired web product's Fractal theme.

The composition is an icon workflow rail, a compact chat/workspace sidebar, and a spacious conversation canvas with a bottom composer. Chat, Projects, Spaces, Bots, Images and Videos are distinct destinations. Dark neutral surfaces, fine separators, restrained radii and system typography keep the working content primary. The P monogram is an original code-native SVG.

All color roles live in `src/tokens.css`; colors use OKLCH and support a future light mode through `light-dark`. Spacing uses logical properties, a 4/8px rhythm, and fluid shell widths. There are no downloaded fonts, decorative image assets or continuous effects. Native Windows chrome supplies standard window behavior.

Use icons for recognized actions with accessible names and keyboard-accessible tooltips. Keep visible labels for workflow context, unfamiliar actions such as Delete Soon, model choices, destructive actions and useful errors. Do not hide consequences or connection status behind hover. Menus and dialogs use Radix focus, escape and focus-return behavior; unknown capabilities show explicit planned states.

The composer accepts Enter to send and Shift+Enter for a newline, preserving IME composition. Its direct visual reference is T3 Chat, inspected live on 29 October 2026: 16px input at 24px line height, a borderless editor, two-line initial writing space and a distinct control row within one rounded surface. Pavane retains its neutral palette and reference-requested model placement, with a circular send/stop action. Focus belongs to the outer composer; never draw a second rounded input box inside it. Long drafts grow to a bounded scroll area while preserving the toolbar. Ctrl+K opens title search; Ctrl+Shift+O creates a chat. Navigation, search, copy, cancellation, rename, keeping and deletion stay keyboard-reachable. Reduced motion removes the spinner rotation and motion transitions without hiding status text. A structural narrow-window rule turns the sidebar into a dismissible overlay; it does not shrink the whole desktop.

User messages use quiet right-aligned bubbles; assistant replies use the full reading column with a provider/model label. Replies support Markdown, lists, tables and code blocks with copy actions. Raw HTML and remote images are blocked. Links require an explicit user click and open through a native HTTP/HTTPS-only command.

The model picker follows the supplied reference: provider/favourites rail, search, compact model rows, stars and a reasoning/service-tier flyout. Show only capabilities returned by that model's provider. A single click selects a model; comparison is an explicit mode with up to four responses. Arrow keys and Enter navigate the list; Ctrl+D stars a model, ArrowRight opens its options and Ctrl+1–9 selects favourites. Preserve selections across restarts, including an unavailable selection rather than silently sending to another model. No permissions switch is exposed in text chat.

Keep connection and quota claims tied to actual provider data. Unknown limits remain unknown. Attachments, autonomous tools and media generation stay explicitly planned.
