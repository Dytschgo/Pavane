# Decisions

## DEC-0001 — Desktop direction replaces the retired SaaS

Accepted by Dylan on 29 October 2026: a public-source, Windows-first Rust desktop app unifying Chat, Projects, Spaces, Bots, Images and Videos. SQLite holds local conversations. The supplied sketch and shadcn/ui define the UI direction. This supersedes all historical web/tenant/hosting plans; no existing hosting resources are modified. Licensing is explicitly deferred by Dylan.

## DEC-0002 — A working chat slice before autonomous tools and media

Implementation decision under the authorized first-version scope: use Tauri 2 + system WebView2, Rust-owned SQLite, React and local accessible UI primitives. Deliver durable chat, local-model streaming, fixed 30-day retention, reusable workspaces and bounded parallel comparison first. Scaffold later workflows honestly. The first PR is intentionally cohesive across schema, native runtime and renderer: those parts together prove the requested persistence and desktop flow. Splitting them into nonworking fragments would obscure that contract.

No subscription credentials or paid provider calls are needed for development. Codex app-server is the next researched subscription candidate, pending tool-isolation and auth/limit verification. Do not present consumer subscriptions as universal API entitlements, nor parallel independent responses as autonomous swarms.

## DEC-0003 — Retention is local and measured from creation

Delete Soon means durable local storage with a fixed creation + 30-day expiry, not incognito mode and not a rolling last-active window. The app rejects access at the deadline and purges rows on startup/every minute while running. Keep clears the deadline before expiry. No secure-erasure or provider-side deletion promise is implied. Backups and future assets need explicit lifecycle support.
