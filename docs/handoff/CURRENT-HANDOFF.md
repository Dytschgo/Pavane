# Current handoff — 30 October 2026

Active checkout: `D:/Code/Pavane-desktop`, branch `feat/desktop-foundation`, draft [PR #1](https://github.com/Dytschgo/Pavane/pull/1) against `develop`. No merge/release publication or license choice. Preserve retired dirty `D:/Code/Pavane`; do not push its files or bypass its deletion block.

## Current work

`PV-NATIVE-004`, Sol: continue Dylan's Windows-first Rust/SQLite chat hill climb. On 30 October Dylan explicitly permitted Pavane tests/builds on this computer while asleep; that supersedes the earlier local-test prohibition. LabManager-specific verification still goes through its separately authorized lab path. This exception does not authorize LabManager host builds, native manager input or cleanup attestation.

The app includes durable normal/30-day chats, drafts/history/recovery, local workspaces/bot instructions, Ollama, four-way comparison and official Codex subscription chat with real model/reasoning/tier/limit discovery. Chat has a T3-inspired composer/picker and safe Markdown. Other provider adapters, autonomous swarms, attachments and media generation remain planned.

Previous head `f0885a6` passed Windows CI. The overnight changes add bounded draft persistence (one active plus latest pending snapshot per chat), Unicode byte-limit feedback that preserves oversized text in this window, nonblocking background discovery, clearer Markdown headings/focus treatment and explicit named database profiles. Normal data and schema are unchanged. Independent read-only draft/profile reviews found no material correctness issue; the profile reviewer’s evidence-ownership finding was fixed by recording fixture directories before launch.

## Actual local evidence

31 renderer tests, lint/types/format, clippy and 24 Rust tests passed (one live unit test ignored). Native mock smoke passed 12 workflows, including reload/restart/retention/comparison/cancellation and Unicode recovery. Real Codex smoke passed all eight checks, including streamed Markdown, model controls/favourites, reload, interrupt and forced-exit provider job cleanup. A signal-exit fixture teardown bug was corrected and the full command then exited successfully.

The actual optimized bundled release passed all routes and native draft reload without Vite, using fresh `--profile verify-UUID` SQLite and separate WebView directories. Three warm-machine samples had median composer-ready 543 ms, discovery 2900 ms, process-tree private memory 235.5 MiB and aggregate working set 533.4 MiB (shared pages can be counted twice). This is an idle baseline with CDP enabled, not cold/peak or a measured RAM improvement.

Current standalone: `target/release/pavane.exe`, 8,567,296 bytes, SHA-256 `878d2cbe881981fd6f7a9c2f97843aefc3fe827e43a746dfccc25ef0d052ce07`. It now contains Codex and the updated chat, not the old foundation. Root gracefully closed the old idle foundation instance (PID 94596) to release its build lock, preserving saved data. No installer/signing/published release. See [verification](../VERIFICATION.md) and [repeatable commands](../TESTING.md).

## Lab state remains separate

The one old managed attempt for `d2917ee` failed during host hashing: job `job-59771bccefd44954acd14bec31d824ce`, reservation `reservation-dd0dcab1bfce448a9f81e2f4288c5655`, recorded run `windows-test/20261029T221740Z-00bce28e941c`. It remains unknown/cleanupfalse/reconciling. Private DPAPI token and durable submission guard are retained outside source; no retry/release/cancel or new Pavane submission occurred.

Installed LabManager 2.4.2 release `20261030-011914` hash and real MCP status/preflight passed read-only at 00:25:13Z; preflight correctly retains cleanup-required. Genuine human Recovery attestation is still required before owner release/reprobe. LabManager 2.4.3 policy-proposal source is reviewed but unbuilt/uninstalled; its exact new 300-second `Verify-PolicyProposals.ps1` maintenance request awaits Dylan's specific approval. No permission is inferred from local Pavane testing. See [lab contract](../LAB-VERIFICATION.md) and the [LabManager thread](t3-thread://v2/950f5165-f55d-4ffd-9b15-4b87e10b4d15/mcp:launch:49276477c271f9626d2377602436727a444f6648708260d263d620113c4182cd).

## Next

Push the tested source pass and read its Windows CI result; keep PR1 draft/unmerged. Give Dylan the current executable for testing. Further hill climbing should use observed workflows/performance, not assumed provider parity. Preserve user data and the historical lab incident; local success cannot clear its fence. The source/provenance reports describe WIP source at run time, so check their manifest/hash when correlating a later commit.
