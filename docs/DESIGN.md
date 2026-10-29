# Pavane desktop design

The accepted reference is Dylan's three-column sketch supplied on 29 October 2026 and the [shadcn/ui component language](https://ui.shadcn.com/docs/components). This supersedes the retired web product's Fractal theme.

The composition is an icon workflow rail, a compact chat/workspace sidebar, and a spacious conversation canvas with a bottom composer. Chat, Projects, Spaces, Bots, Images and Videos are distinct destinations. Dark neutral surfaces, fine separators, restrained radii and system typography keep the working content primary. The P monogram is an original code-native SVG.

All color roles live in `src/tokens.css`; colors use OKLCH and support a future light mode through `light-dark`. Spacing uses logical properties, a 4/8px rhythm, and fluid shell widths. There are no downloaded fonts, decorative image assets or continuous effects. Native Windows chrome supplies standard window behavior.

Use icons for recognized actions with accessible names and keyboard-accessible tooltips. Keep visible labels for workflow context, unfamiliar actions such as Delete Soon, model choices, destructive actions and useful errors. Do not hide consequences or connection status behind hover. Menus and dialogs use Radix focus, escape and focus-return behavior; unknown capabilities show explicit planned states.

The composer accepts Enter to send and Shift+Enter for a newline, preserving IME composition. Ctrl+K opens title search; Ctrl+Shift+O creates a chat. Navigation, search, copy, cancellation, rename, keeping and deletion stay keyboard-reachable. Reduced motion removes the spinner rotation and motion transitions without hiding status text. A structural narrow-window rule turns the sidebar into a dismissible overlay; it does not shrink the whole desktop.

The V1 surface intentionally renders safe plain text. Rich Markdown/code presentation, attachments and export follow the working persistence slice. This design promises no fake conversations, numeric quotas, connected accounts or media generation results.
