# Pavane Windows lab run

User instruction, 29 October 2026: test on the lab Windows PC through LabManager, not on the coding PC. Local test processes and the dev server were stopped. Source editing, review and job preparation remain local.

Use LabManager's installed stdio MCP adapter with the stable session `pavane-codex-002`. The coding session does not expose LabManager tools directly; the installed `lab-manager.exe mcp --session pavane-codex-002` adapter connects to the same native manager. Do not use a direct runner or SSH to bypass manager policy or reservation state.

## Concrete job scope

- Source: `D:/Code/Pavane-desktop`, branch `feat/desktop-foundation`; transfer only application source, lockfiles and scripts. No old Pavane checkout, credential stores, SQLite files, node_modules, target, evidence or `.git` objects.
- Environment: `windows-test` / retained `agent-windows-test`; no power, checkpoint or policy changes by the agent.
- Command: `& .\scripts\verify-windows.ps1`; desktop execution required, with up to 1800 seconds for dependency restore, checks, native UI and optimized build.
- Existing prerequisites: Windows x64, MSVC Rust 1.90+, Node 24+, pnpm 10.34.5 and WebView2. Restore locked project dependencies in the guest. Missing toolchains fail explicitly; no host installation.
- Optional real inference: add `-LiveCodex` only when the guest already has the official CLI signed in with ChatGPT. Never copy the coding PC's auth/config files or tokens. No new API-key billing.
- Evidence: bounded synthetic reports/screenshots in `lab-evidence`; app data and WebView profiles use temporary guest directories. No real user messages or raw provider logs.
- Retained Windows evidence: `scripts/verify-windows.ps1` copies the exact allowlisted reports/screenshots to `$env:AGENTLAB_EVIDENCE_DIR` when set, inside the guest, including failure/finally handling. Fixture output uses a fresh temporary directory so stale source captures cannot be exported as current evidence. Raw logs, auth stores, SQLite and binaries are excluded from this export.
- Recovery: scripts stop their own app/server processes; source rollback preserves user databases. Keep the reservation until the manager confirms cleanup. The retained legacy Windows runner cannot acknowledge descendant/workspace cleanup, so its managed job may remain fenced after completion; that requires native operator reconciliation, not ledger edits or forced release.

## Current gate

The MCP readiness probe returned `unavailable`: **The Windows test runner is busy.** Inventory also reports `executionPolicyApproved=false` for `windows-test`; the only approved source policy is for another project/environment. Dylan subsequently explicitly approved the scoped native setup/admin change. Computer Use was stopped with physical Escape in the policy editor before any policy was saved. No Pavane job or reservation has been submitted. Execution still needs the scoped policy and an available runner; resuming native UI control needs a new user instruction.

Dylan then requested a separate thread in the Lab Manager project to repair/configure the supported MCP path. It was created and started: <t3-thread://v2/950f5165-f55d-4ffd-9b15-4b87e10b4d15/mcp:launch:49276477c271f9626d2377602436727a444f6648708260d263d620113c4182cd>. The brief includes the exact Pavane scope, existing setup authorization, busy-owner preservation and the retained Windows runner's cleanup limitation. Pavane source changes remain owned by this thread; the LabManager thread must not edit or push them.

Progress relayed by Dylan: native policy `pavane-windows-verification` is saved and MCP-verified, permitting only this source -> `windows-test`, maximum 1800 seconds; provisioning, tool-install and preview grants remain false/empty. Existing policy is unchanged. At 21:14:23Z readiness reported ready+desktop; a reservation was acquired/released without dispatch. LabManager identified and is fixing source validation traversing pnpm junctions despite transport exclusions. Its guest build is queued behind the existing lock. **Do not submit Pavane until the verified repair release/handoff arrives.** The legacy cleanup fence remains unchanged. Candidate source/runtime is `5473ce0`; later documentation-only commits do not change it.
