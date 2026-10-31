# Provider connection audit — 31 October 2026

PV-PROVIDER-002 remains in progress. This audit establishes supported integration candidates and the next implementation boundary. It adds no adapter or connection claim. Codex and Ollama remain the working providers; the latest native-verified executable is still `3eb83fb`. The documentation checkpoint `1163b24` passed CI; its unchanged app/harness needed no duplicate native run.

## Correction after release qualification

The earlier audit missed Google's dated deprecation notice. Its [consumer-account documentation](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals) says Gemini CLI stopped serving individual, Google AI Pro and Ultra consumer access on 18 June 2026. The generic CLI authentication guide still describes those accounts. The dated notice and [transition announcement](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/) take precedence for this decision; an ACP interface and cached login are not current consumer entitlement. Separate enterprise/API access is not ruled out.

The consumer CLI proposal is retired. [ADR-0003](decisions/ADR-0003-GEMINI-API.md) selects the direct Gemini API/key path, now authored but awaiting CI/lab verification. Antigravity is a distinct integration and has not been qualified here. [Implementation and limits](GEMINI-API.md).

## Findings

| Provider | Documented entry point                                     | Authentication/billing boundary                                                                                                                                             | Pavane decision                                                                                                                                            |
| -------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude   | Direct API/Client SDK; Agent SDK invokes Claude Code       | The SDK guidance directs third-party products to API-key auth unless previously approved. Offering an unmodified Claude Code binary under its own terms is a distinct case. | Do not offer Claude-account login or import subscription tokens into Pavane. Keep the protected API-key route as the implementation candidate.             |
| Gemini   | Direct Gemini API; CLI consumer route retired              | The dated notice overrides the generic authentication guide for the consumer case. API access has separate credentials/limits/billing.                                      | Implement the protected API-key path; no subscription-login claim.                                                                                         |
| Grok     | Official Grok Build ACP over stdio; separate inference API | The CLI supports its own browser/cached-token authentication. Grok and API billing are separate.                                                                            | ACP is a real candidate, not an assumed API entitlement. Defer behind Gemini until startup configuration, tools, storage and Windows behavior are bounded. |

Claude sources: [Agent SDK guidance](https://code.claude.com/docs/en/agent-sdk/overview) and [authentication/product-hosting conditions](https://code.claude.com/docs/en/legal-and-compliance). The latter distinguishes customers running the published binary from third parties routing subscription requests through their own application. This audit does not establish an exception for Pavane or make a blanket claim that all CLI hosting is prohibited.

Gemini sources: [CLI authentication](https://geminicli.com/docs/get-started/authentication/), [ACP mode](https://geminicli.com/docs/cli/acp-mode/) and [quota/pricing](https://geminicli.com/docs/resources/quota-and-pricing/). These describe the protocol, but the dated correction above supersedes the consumer eligibility assumption. No login or inference was tested. Do not hard-code advertised plan allowances as remaining usage.

Grok sources: [official integration overview](https://docs.x.ai/build/overview), [headless/ACP lifecycle](https://docs.x.ai/build/cli/headless-scripting) and [separate API billing](https://docs.x.ai/console/faq/accounts). The official ACP example uses existing CLI authentication and `session/update` text chunks. A model list or cached credential is not proof that a particular plan includes that model. API billing separation does not rule out CLI access through the provider's supported login.

## Source inspection that changes the design

Public source was downloaded read-only through GitHub's content API at fixed revisions; none was executed or copied into Pavane. No local provider configuration or credential file was opened.

Gemini revision [`6814e00d6b148c3a1d57244d5d7040f7c541009d`](https://github.com/google-gemini/gemini-cli/tree/6814e00d6b148c3a1d57244d5d7040f7c541009d):

- [`acpSessionManager.ts`](https://github.com/google-gemini/gemini-cli/blob/6814e00d6b148c3a1d57244d5d7040f7c541009d/packages/cli/src/acp/acpSessionManager.ts), `newSessionConfig`, starts with configured MCP servers and adds those supplied by the client. Consequently, sending `mcpServers: []` alone does **not** disable inherited servers. Authentication precedes `config.initialize`, which is useful sequencing but does not establish isolation.
- [`config.ts`](https://github.com/google-gemini/gemini-cli/blob/6814e00d6b148c3a1d57244d5d7040f7c541009d/packages/cli/src/config/config.ts), `loadCliConfig`, handles extension loading, admin MCP/extension switches, core tools and hooks. [`core config`](https://github.com/google-gemini/gemini-cli/blob/6814e00d6b148c3a1d57244d5d7040f7c541009d/packages/core/src/config/config.ts), `createToolRegistry`, treats an explicit empty core-tool list as disabling the built-ins gated by `maybeRegister`. This is a source-level candidate control, not proof that every startup side effect is disabled.
- [`settings.ts`](https://github.com/google-gemini/gemini-cli/blob/6814e00d6b148c3a1d57244d5d7040f7c541009d/packages/cli/src/config/settings.ts) merges configuration layers and supports a child-only system-settings path. [`acpSession.ts`](https://github.com/google-gemini/gemini-cli/blob/6814e00d6b148c3a1d57244d5d7040f7c541009d/packages/cli/src/acp/acpSession.ts) uses a pending-prompt abort controller and emits assistant, thought, tool and usage events. Display only assistant text; do not interpret context/token usage as a subscription balance.

The [configuration reference](https://geminicli.com/docs/reference/configuration/) documents separate hooks, skills, MCP and extension controls and configurable system-settings paths. Changing `GEMINI_CLI_HOME` also relocates user storage; it is not a supported reason to copy credentials into an isolated home. Whether one child-only launch profile preserves CLI-owned auth while suppressing inherited executable/context behavior remains an implementation/test requirement.

Grok revision [`2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`](https://github.com/xai-org/grok-build/tree/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8): the [published shell README](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/README.md) documents ACP and CLI-owned auth; [`agent/config.rs`](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/agent/config.rs) exposes further model/feature configuration. This bounded read is not a complete Grok tool-isolation audit. The [settings reference](https://docs.x.ai/build/settings/reference) documents multiple compatibility scanners, hooks/MCP and shared home storage. Disabling writes or refusing ACP file requests alone cannot prove a tool-free child process. [Permissions](https://docs.x.ai/build/features/permissions) are distinct from filesystem/network sandboxing.

## Current implementation direction

Use the [Gemini API slice](GEMINI-API.md), not the retired consumer CLI plan. Preserve the supported-interface/auth boundary for each later provider. The inspected MCP/config inheritance remains a valid source finding, but it does not justify spending a consumer qualification run on an unsupported account route. CLI source qualification stopped before installation, authentication or execution.

## Validation and rollback

The original audit checkpoint changed documentation only; later API source work is recorded separately in GEMINI-API.md. Validate formatting, local links/anchors, source identities and the final diff. No app tests/builds, CLI probes, login, provider requests, guest dispatch, installation or local UI occurred. Private copies and a SHA256 manifest of the eight inspected public files remain under `%LOCALAPPDATA%/LabManager/pavane-provider-audit-20261031`; they contain public source only. No raw auth or provider runtime data is retained.

Rollback removes this audit/decision and restores the previous task/plan pointers. Existing app behavior, SQLite, provider configuration, accepted executable, lab receipts and immutable submission guards are unchanged. Research complete does not mean adapters complete: PV-PROVIDER-002 stays working until a supported connection is implemented and verified.

## Claude follow-up — 31 October

The next bounded implementation is the [Claude Console-key/workspace contract](CLAUDE-CONNECTION-PLAN.md). It records the current versioned API and keeps the documented unmodified Claude Code subscription exception as a separate qualification candidate. The earlier audit is historical; it must not be read as a blanket subscription prohibition. Public-only research, no runtime or live account acceptance.
