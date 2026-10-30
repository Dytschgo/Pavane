# Current plan

`PV-LAB-005` is complete for its bounded native UI acceptance: source-bound prebuilt candidate `3f82cde` passed actual Windows lab run `20261030T185029Z-544145d70218`, 12 native workflows and two standalone checks, nine screenshots inspected. Supported disposal completed and fresh desktop probe/status is ready/available. The guest has no Cargo; its existing Node 22.23.3/pnpm 11.25.0 runs the tested UI-only verifier without tool installation or host auth transfer. [Proof and limits](../VERIFICATION.md).

Finish this checkpoint's documentation/diff, push the source-only commits and inspect Windows CI through the existing PR watch. Keep draft PR #1 unmerged, license deferred, historical checkout and old submission guards intact. No binary/evidence/auth/database belongs in Git.

Next product pass: `PV-PERF-002`, measure long streaming Markdown and large-history input/scroll responsiveness before choosing optimizations. Continue adaptive/keyboard workflow checks based on observations. API/provider adapters, autonomous swarms, attachments/media, richer context and signed installer remain separate unfinished tasks. Local Pavane testing is authorized; LabManager-specific work stays on its supported lab path with current ownership/recovery gates.
