# Retired Gemini ACP prototype

Commit [64db4bf](https://github.com/Dytschgo/Pavane/commit/64db4bfe979fb767972c21de9c0bc8f6e7f971f7) implemented a bounded, unexposed ACP wire layer. Its 15 synthetic-peer tests passed in [CI run 41152874764](https://github.com/Dytschgo/Pavane/actions/runs/41152874764). It was never connected to a launcher, Tauri, discovery or a user model. These results established transport behavior, not real CLI isolation/auth or account access.

Subsequent qualification found the official consumer-route correction described in [provider connections](PROVIDER-CONNECTIONS.md). The unused module/export and its tests were removed as part of the [direct API slice](GEMINI-API.md); no existing user workflow was removed and no failed test was bypassed. Code, review findings/corrections and passing test history remain available in Git. Do not restore it as a consumer subscription adapter. Enterprise/alternative product integrations require their own supported contract and qualification.

The current direct API path uses its own HTTP, credential and UI regressions. [ADR-0003](decisions/ADR-0003-GEMINI-API.md) supersedes the prototype direction. Latest accepted app binary remains 3eb83fb until new CI/lab evidence is recorded.
