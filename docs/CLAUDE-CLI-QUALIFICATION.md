# Claude CLI subscription qualification — 31 October 2026

PV-PROVIDER-002 public-document follow-up; no launcher, installed CLI/config/auth access, download, account operation or inference. The direct Claude API remains implemented and separately verified. This records why a subscription-ready CLI is not exposed yet, rather than treating API and subscription credentials as interchangeable.

The [hosting conditions](https://code.claude.com/docs/en/legal-and-compliance#can-customers-offer-claude-code-in-their-products) describe running the unmodified published binary under Commercial Terms while preserving built-in authentication choices and end-user billing. They distinguish that from collecting consumer credentials or implementing a separate subscription-token client. This is a conditional integration candidate; this research does not accept terms or establish live account eligibility.

The [programmatic guide](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode) makes bare mode unsuitable for the proposed subscription login: it skips OAuth credentials and the system keychain. Normal print mode can load hooks/MCP without an interactive trust prompt. Bare mode is useful for API-key scripting but cannot prove a CLI-owned subscription route works.

The [CLI reference](https://code.claude.com/docs/en/cli-reference) separates controls: tools empty disables built-ins, while MCP needs its own restriction. Safe mode preserves authentication but still applies managed hooks/commands. Restricted mode retains managed settings too. These flags alone are not proof of a plain-text child process with no inherited executable behavior.

The [settings reference](https://code.claude.com/docs/en/settings-reference#disableallhooks) explicitly preserves managed hooks when disableAllHooks is supplied outside managed policy. User launch settings cannot turn that into a universal no-hooks guarantee. The [managed MCP contract](https://code.claude.com/docs/en/managed-mcp) does provide a useful failure boundary: a conflicting strict MCP configuration refuses startup, rather than silently replacing the managed set. That behavior still needs real pinned Windows acceptance.

## Remaining implementation gate

Qualify a published binary/version and a supported child-only profile that retains CLI-owned authentication while preventing inherited command hooks, MCP, plugins, memory/context and automatic background work from executing outside the chat contract. Preserve organization policy; do not edit managed/user settings, relocate/copy credentials, patch the binary or bypass auth. If policy makes that profile unavailable, fail before requesting a model turn. A fixed working directory or a process-tree cleanup Job Object does not establish filesystem/network confinement.

Then define bounded stdout event parsing, supported model discovery, partial/cancellation semantics, deadlines and any authoritative usage fields. Use disposable Windows fixture evidence with before/after configuration hashes and inherited-hook/MCP sentinels, plus owned descendant cleanup. No paid or real-account test is implied. Until those gates are met, keep the implemented API route and continue independent chat improvements. Rollback removes these research notes only; no runtime/data/auth state changed.
