# Current handoff

## Desktop foundation — 29 October 2026

User direction: Windows-first Rust/SQLite desktop app with six workflows, durable Delete Soon chats, model subscriptions, visible provider limits and eventual swarms. The supplied sketch and shadcn/ui supersede the retired SaaS design and architecture. License choice is deferred explicitly.

Active checkout: `D:/Code/Pavane-desktop`, branch `feat/desktop-foundation`, based on `develop` root `46aaf8493dba4e8bc0f5f40ef5e46abfcef488c8`. Preserve `D:/Code/Pavane` and its old user changes/history; the local deletion block remains. Do not push its historical files into this new project.

Implemented foundation: Tauri 2 Windows shell, Rust SQLite core, normal/30-day chat lifecycle, drafts, rename/keep/delete, bounded history, interrupted-run recovery, local Ollama streaming with cancellation, parallel model comparison, local workspace/bot instructions, six routes with planned media states, keyboard and Radix interactions. No source copied from T3; two read-only Luna research tasks inspected T3 and provider docs.

Current verification: seven renderer tests, nine storage/recovery tests and two native decoder tests pass, as do formatting, lint, types, clippy, the optimized executable build, targeted native smoke and bundled release launch. Two independent review rounds found and resolved persistence/reload/expiry defects; the final regression forces the deferred-read timing. See [verification](../VERIFICATION.md) for revisions, evidence, the first memory sample and limitations. No merge, published release, paid inference, hosting or production infrastructure change has occurred.

Next work: subscription/provider integration and memory profiling. The full WebView process-tree footprint has been measured once and must not be described as optimized or proven low-RAM. License remains deferred. The first source PR is prepared against develop; its link/status will be recorded below.

## Reviewable PR

[PR #1](https://github.com/Dytschgo/Pavane/pull/1) targets develop and remains open/unmerged. Local validation and both independent review dispositions are recorded in VERIFICATION.md. T3 reported the single Windows CI check passed on foundation head `868ca64`. That result does not cover the subsequent local Codex/chat work. The standalone executable is target/release/pavane.exe; no installer or release was published.

## Hill climb checkpoint — lab verification pending

The committed runtime/UI candidate is `5473ce0`; subsequent verifier evidence-export changes are separate from app behavior. Codex subscription discovery and a real Sol round trip worked before Dylan directed all further tests/builds to the lab Windows PC. The latest startup-send guard, rejected-turn cleanup regression and T3 Chat composer correction have not been executed. Do not present the current source as verified by the foundation PR check, or the existing release executable as the updated Codex build. See [the verification log](../VERIFICATION.md) for exact prior checks and remaining work.

The installed LabManager stdio MCP adapter was located and used for discovery. Windows readiness reported a busy runner, and Pavane had no approved execution policy. Dylan explicitly authorized the scoped native setup/admin change. Computer Use was then stopped by physical Escape while editing the new policy; no policy was saved, no reservation acquired and no Pavane lab job submitted. Do not resume desktop automation without a new user instruction. [The prepared lab plan](../LAB-VERIFICATION.md) and `scripts/verify-windows.ps1` retain the intended job. The local dev server and test app were stopped; preserve the user's database and old checkout.

The separate LabManager thread subsequently saved and MCP-verified the exact `pavane-windows-verification` policy and verified readiness/reservation release without dispatch. Its pnpm junction validator repair is now building in AGENT-WIN; do not start the old adapter or submit Pavane during the manager swap. Await its final verified-release/MCP handoff. Use one batched `& .\scripts\verify-windows.ps1`, desktop=true, timeoutSeconds=1800, retain the token and evidence, and respect unknown/cleanupConfirmed=false from the legacy runner. The verifier exports allowlisted synthetic reports/screenshots to `AGENTLAB_EVIDENCE_DIR` in finally as well as `lab-evidence`; fresh temporary fixture output avoids exporting stale captures. No Pavane guest run has started yet.
