# Pavane Windows lab run

## Latest disposition — 30 October, 18:27 UTC

Installed LabManager 2.4.7 (`20261030-192334`) repairs the nested WinPS native-stderr/completion seam and BOM-aware artifact decoding. Root verified adapter SHA-256 `CBECCE29CB23F5BE05EEF01380600FAA4416C303CCA0BFB636A6D046F2A06BD4` and status at 18:29:44Z: available, no reservation. Later sections preserve historical gates and are not the current runtime state.

Both old attempts are disposed through supported recovery. The new `cd8a61c` attempt, job `job-634d7ffc397c473a9df6ebf6a2a42a75`, request `pavane-cd8a61c-windows-001`, retained run `20261030T174907Z-92a86390702d`, failed before checks: Cargo was missing. Manager history preserves unknown/null exit with `aborted-by-reset`, cleanup confirmed, reservation `reservation-8481c13e858d452383f94df1ca22894d` retired. LabManager owned recovery `906d2e24b1824cc3bbf98cf0295f341e`, BootId 6→7, completed 17:58:15Z. Root did not access/replay its old token/guard or release it. Preserved guest verification report SHA-256: `958C865213417BFEE358C51E750689669D5C59A96F6E54B25BFA50EAA9B45C0A`. No Pavane checks passed in that attempt.

The next candidate uses the [prebuilt UI path](PREBUILT-VERIFICATION.md), avoiding a prohibited Rust installation. It requires a distinct reservation/request/guard after fresh desktop probe and exact preflight. Source and binary manifests must be retained, and the reduced scope reported. The installed fixed-VM autonomous disposal grant replaces the earlier human-only recovery gate for eligible unknown jobs; use only its supported MCP operation, never ledger edits or fabricated receipts. There is still no queue or normal reusable-job supervision.

User instruction, 29 October 2026: test on the lab Windows PC through LabManager, not on the coding PC. Local test processes and the dev server were stopped. Source editing, review and job preparation remain local.

Update, 30 October: Dylan subsequently explicitly permitted local Pavane testing while asleep. That supersedes the opening restriction for Pavane only. Specifically coordinated LabManager verification still belongs on the lab under its actual approval/cleanup gates; no local LabManager builds/tests or fence bypass is authorized. Local native results are in [VERIFICATION.md](VERIFICATION.md).

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

## Historical setup gate

The MCP readiness probe returned `unavailable`: **The Windows test runner is busy.** Inventory also reports `executionPolicyApproved=false` for `windows-test`; the only approved source policy is for another project/environment. Dylan subsequently explicitly approved the scoped native setup/admin change. Computer Use was stopped with physical Escape in the policy editor before any policy was saved. No Pavane job or reservation has been submitted. Execution still needs the scoped policy and an available runner; resuming native UI control needs a new user instruction.

Dylan then requested a separate thread in the Lab Manager project to repair/configure the supported MCP path. It was created and started: <t3-thread://v2/950f5165-f55d-4ffd-9b15-4b87e10b4d15/mcp:launch:49276477c271f9626d2377602436727a444f6648708260d263d620113c4182cd>. The brief includes the exact Pavane scope, existing setup authorization, busy-owner preservation and the retained Windows runner's cleanup limitation. Pavane source changes remain owned by this thread; the LabManager thread must not edit or push them.

Progress relayed by Dylan: native policy `pavane-windows-verification` is saved and MCP-verified, permitting only this source -> `windows-test`, maximum 1800 seconds; provisioning, tool-install and preview grants remain false/empty. Existing policy is unchanged. At 21:14:23Z readiness reported ready+desktop; a reservation was acquired/released without dispatch. LabManager identified and is fixing source validation traversing pnpm junctions despite transport exclusions. Its guest build is queued behind the existing lock. **Do not submit Pavane until the verified repair release/handoff arrives.** The legacy cleanup fence remains unchanged. Candidate source/runtime is `5473ce0`; later documentation-only commits do not change it.

## Current gate — 30 October 2026

The exact native policy is saved and verified as scoped above. Earlier busy-runner and pnpm-junction validation blockers were repaired without stealing locks or changing VM power. Exactly one Pavane job was submitted when fresh readiness and preflight passed, for clean head `d2917eedf057067e7d3688a5eddc30916dc76c6e` with stable request ID `pavane-d2917ee-windows-001`.

Job `job-59771bccefd44954acd14bec31d824ce`, reservation `reservation-dd0dcab1bfce448a9f81e2f4288c5655`, recorded run `windows-test/20261029T221740Z-00bce28e941c` ended exit 1, **unknown/cleanupConfirmed=false**. The reservation remains reconciling. Only host-result evidence exists: `Get-FileHash` was unavailable during retained-runner source hashing. No Pavane verifier report, native interaction result or screenshots were produced. The older format has no durable no-dispatch acknowledgement, so the apparent early failure cannot establish cleanup.

Dylan authorized a separate isolated LabManager maintenance build/install. Installed 2.4.1 at `C:/Users/DylanFerraro/agent-tools/lab-manager/releases/20261029-234837/lab-manager.exe` fixes inherited PS7 module paths in exact WinPS child launches. Its adapter SHA-256 is `A131BBDD6311507A16E6AD077E5A62B8FF9F5138846A89ABB3E81107E8E1FDC6`. LabManager guest checks passed, including nine launch regressions. These establish the launch mechanism, not historical Pavane cleanup.

Root verified this exact adapter's hash, MCP initialization, `get_environment_status` and `preflight_job` at 2026-10-29T22:52:08Z. Policy/source/deadline checks passed. Preflight remained ready=false with occupancy cleanup-required, legacy-unconfirmed transport and reusableJobs=false. No new reservation, submission, retry, release, cancel or token change occurred. The token remains current-user DPAPI protected outside the source tree; the private client preserves a durable single-submission guard.

The [LabManager project thread](t3-thread://v2/950f5165-f55d-4ffd-9b15-4b87e10b4d15/mcp:launch:49276477c271f9626d2377602436727a444f6648708260d263d620113c4182cd) is implementing supported native operator reconciliation. No agent may attest cleanup, inject a receipt, edit the ledger or infer managed reuse from an unlocked runner. Further guest-maintenance exceptions and actual operator cleanup acknowledgement remain separate gates. Computer Use was physically stopped earlier and has not resumed. The original job/commit remain immutable incident evidence while new source work proceeds separately.

## Read-only checks and eventual resumption

Use the exact installed adapter and stable session above, with normal initialize/notifications/initialized. MCP `tools/call` names and arguments:

```json
[
  {
    "name": "get_environment_status",
    "arguments": { "environmentId": "windows-test" }
  },
  {
    "name": "preflight_job",
    "arguments": {
      "environmentId": "windows-test",
      "policyId": "pavane-windows-verification",
      "sourcePath": "D:\\Code\\Pavane-desktop",
      "timeoutSeconds": 1800,
      "desktop": true
    }
  }
]
```

Successful status calls or physical readiness do not authorize dispatch while cleanup is unconfirmed. Do not reserve/submit/retry/release/cancel under the current fence. Once a supported native recovery gate is actually satisfied, identify and preflight the new source candidate explicitly; never silently replay the old request or weaken the saved guard. Keep the exact core verifier invocation above. Inspect correlated run artifacts and allowlisted reports/captures, and claim native acceptance only from that candidate's actual evidence.

## Installed recovery, pending human action

Installed 2.4.2 (`20261030-011914`) adapter SHA-256 `CA9C69B4435CD125E4C98A8E8776FC196A592DB2056FFDAC4766155E71A65C43` was independently checked through real initialize/status/preflight at 2026-10-30T00:25:13Z. Policy/source/timeout/readiness/desktop passed; occupancy remained cleanup-required. A further preflight at 00:32:05Z remained blocked. The original private client’s adapter identity was updated without changing its token or durable submission guard. No new Pavane submission or release occurred.

The installed native Recovery dialog now supports genuine human cleanup attestation. Maintenance fixture success does not perform it. After the operator independently establishes cleanup and records the receipt, only the original owner may perform supported release/reprobe. Hyper-V preparation has refused the normal manager process’s missing read rights; any operator elevation is separate from agent automation. Preserve the physical-stop boundary for LabManager UI.

LabManager 2.4.3 policy-proposal source/review is settled but unbuilt/uninstalled. Its next exact `Tests/Verify-PolicyProposals.ps1` desktop maintenance run (300 seconds, queue timeout 30) requires a new specific Dylan approval. This is not a Pavane test, cleanup acknowledgement or permission to run LabManager builds on this computer. The one previous maintenance approval was consumed by 2.4.2.
