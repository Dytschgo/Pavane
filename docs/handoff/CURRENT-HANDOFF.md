# Current handoff

## Desktop foundation — 29 October 2026

User direction: Windows-first Rust/SQLite desktop app with six workflows, durable Delete Soon chats, model subscriptions, visible provider limits and eventual swarms. The supplied sketch and shadcn/ui supersede the retired SaaS design and architecture. License choice is deferred explicitly.

Active checkout: `D:/Code/Pavane-desktop`, branch `feat/desktop-foundation`, based on `develop` root `46aaf8493dba4e8bc0f5f40ef5e46abfcef488c8`. Preserve `D:/Code/Pavane` and its old user changes/history; the local deletion block remains. Do not push its historical files into this new project.

Implemented foundation: Tauri 2 Windows shell, Rust SQLite core, normal/30-day chat lifecycle, drafts, rename/keep/delete, bounded history, interrupted-run recovery, local Ollama streaming with cancellation, parallel model comparison, local workspace/bot instructions, six routes with planned media states, keyboard and Radix interactions. No source copied from T3; two read-only Luna research tasks inspected T3 and provider docs.

Current verification: seven renderer tests, nine storage/recovery tests and two native decoder tests pass, as do formatting, lint, types, clippy, the optimized executable build, targeted native smoke and bundled release launch. Two independent review rounds found and resolved persistence/reload/expiry defects; the final regression forces the deferred-read timing. See [verification](../VERIFICATION.md) for revisions, evidence, the first memory sample and limitations. No merge, published release, paid inference, hosting or production infrastructure change has occurred.

Next work: subscription/provider integration and memory profiling. The full WebView process-tree footprint has been measured once and must not be described as optimized or proven low-RAM. License remains deferred. The first source PR is prepared against develop; its link/status will be recorded below.
