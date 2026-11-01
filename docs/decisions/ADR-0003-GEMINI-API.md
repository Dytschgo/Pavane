# ADR-0003 — Use the direct Gemini API after consumer-route correction

Status: accepted implementation direction, verification pending. Supersedes ADR-0002's Gemini consumer CLI selection.

Qualification uncovered the [dated Google transition announcement](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/), which invalidates the consumer route assumed in the earlier generic-guide audit. The precise correction and its source conflict are recorded once in [provider connections](../PROVIDER-CONNECTIONS.md). Antigravity integration has not been assessed or authorized as a substitute here.

Use the supported direct Gemini API with profile-scoped Windows Credential Manager, write-only key controls and explicit API billing text. Discover models without inference, bind availability to the credential revision, then stream only on an explicit send. Fixed HTTPS origin, sensitive headers, no redirects/proxies/retries, no tools/CLI configuration, bounded parsing and existing native cancellation/checkpoints define the boundary. This adds no account setup, paid development calls, schema or global configuration changes.

Retire the unused ACP prototype rather than maintain a path that serves no current consumer workflow. Its passing synthetic tests/history remain in commit 64db4bf; they never established a live provider connection. API/credential regressions now protect the implemented path. [Behavior, verification limits and rollback](../GEMINI-API.md).
