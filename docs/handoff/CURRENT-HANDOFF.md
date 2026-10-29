# Current handoff

## Desktop foundation — 29 October 2026

User direction: Windows-first Rust/SQLite desktop app with six workflows, durable Delete Soon chats, model subscriptions, visible provider limits and eventual swarms. The supplied sketch and shadcn/ui supersede the retired SaaS design and architecture. License choice is deferred explicitly.

Active checkout: `D:/Code/Pavane-desktop`, branch `feat/desktop-foundation`, based on `develop` root `46aaf8493dba4e8bc0f5f40ef5e46abfcef488c8`. Preserve `D:/Code/Pavane` and its old user changes/history; the local deletion block remains. Do not push its historical files into this new project.

Implemented foundation: Tauri 2 Windows shell, Rust SQLite core, normal/30-day chat lifecycle, drafts, rename/keep/delete, bounded history, interrupted-run recovery, local Ollama streaming with cancellation, parallel model comparison, local workspace/bot instructions, six routes with planned media states, keyboard and Radix interactions. No source copied from T3; two read-only Luna research tasks inspected T3 and provider docs.

Current verification: core storage tests and native compilation pass; renderer build, types and lint pass. Actual Windows smoke, release build and independent review are in progress. Do not describe those as passed until the result below is updated. No merge, release, paid inference, hosting or production infrastructure change has occurred.
