# Decisions

## DEC-0006 — Guard saved workspace edits without a migration

PV-CONTEXT-002 uses a parameterized compare-and-swap on the existing workspace fields, retaining ID/kind and linked chats. Reject stale snapshots rather than silently overwriting another edit. Failed saves keep the editor text; explicitly loading the saved version provides recovery without automatic replay. In-flight sends retain their captured instructions; later sends read the saved row. [Scope, verification and rollback](../WORKSPACE-EDITING.md).

Dylan subsequently revoked DEC-0005's sleep-only local testing permission while working on this PC. Current app tests/builds/UI run only in CI or the supported Windows lab; source editing/formatting and evidence inspection remain local.

## DEC-0001 — Desktop direction replaces the retired SaaS

Accepted by Dylan on 29 October 2026: a public-source, Windows-first Rust desktop app unifying Chat, Projects, Spaces, Bots, Images and Videos. SQLite holds local conversations. The supplied sketch and shadcn/ui define the UI direction. This supersedes all historical web/tenant/hosting plans; no existing hosting resources are modified. Licensing is explicitly deferred by Dylan.

## DEC-0002 — A working chat slice before autonomous tools and media

Implementation decision under the authorized first-version scope: use Tauri 2 + system WebView2, Rust-owned SQLite, React and local accessible UI primitives. Deliver durable chat, local-model streaming, fixed 30-day retention, reusable workspaces and bounded parallel comparison first. Scaffold later workflows honestly. The first PR is intentionally cohesive across schema, native runtime and renderer: those parts together prove the requested persistence and desktop flow. Splitting them into nonworking fragments would obscure that contract.

No subscription credentials or paid provider calls are needed for development. Codex app-server is the next researched subscription candidate, pending tool-isolation and auth/limit verification. Do not present consumer subscriptions as universal API entitlements, nor parallel independent responses as autonomous swarms.

## DEC-0003 — Retention is local and measured from creation

Delete Soon means durable local storage with a fixed creation + 30-day expiry, not incognito mode and not a rolling last-active window. The app rejects access at the deadline and purges rows on startup/every minute while running. Keep clears the deadline before expiry. No secure-erasure or provider-side deletion promise is implied. Backups and future assets need explicit lifecycle support.

## DEC-0004 — Codex subscription chat and reference correction

Dylan prioritized a real Codex model and the supplied picker, then rejected the initial composer and asked for T3 Chat as the direct reference. The current candidate uses the official local app-server with CLI-owned credentials and actual model/limit data, with the isolation and rollback contract in [ADR-0001](ADR-0001-CODEX-CHAT.md). This supersedes DEC-0002's initial Ollama-only delivery scope. Safe Markdown replaces plain-text assistant rendering. The UI keeps Pavane's neutral palette while adopting T3 Chat's borderless editor, input typography and separate control row; no T3 source is copied.

Dylan also requires further app builds/tests on the lab Windows PC through LabManager. The exact native policy is authorized; LabManager's separate repair thread owns unblocking its source validation/runner path. Do not bypass the manager or resume coding-PC tests. License choice, merges, provider API billing and production infrastructure remain outside this change.

## DEC-0005 — Local verification permission and explicit database profiles

On 30 October Dylan explicitly permitted Pavane testing on this computer while he sleeps, while keeping specifically requested LabManager verification on the lab. This supersedes DEC-0004's local-test restriction for Pavane only; it does not clear the historical LabManager job, grant a human attestation or authorize LabManager host tests.

Implementation choice: add optional `--profile NAME` database selection so the actual optimized app can be verified without opening normal user SQLite. Release continues to ignore the debug environment override. Names are bounded and cannot contain paths; invalid arguments/storage failures fail without fallback. Profiles route SQLite and Codex workspace together, not CLI credentials or authentication. The fixture also isolates WebView2 explicitly. Source review found no material isolation issue; permission failures and Windows junctions are not a sandbox guarantee. Rollback removes the optional flag while leaving profile directories and normal user data intact.
