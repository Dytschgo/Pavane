# Claude connection contract — 31 October 2026

PV-CLAUDE-API-001 is the next implementation slice under PV-PROVIDER-002. This is a researched contract, not a working connection. No Claude credentials, installed CLI, provider request or live account was accessed. Existing Codex/Ollama/Gemini behavior stays intact.

## Connection routes

The first slice uses a user-supplied Console API key. Anthropic also explicitly permits products to run the **unmodified Claude Code binary** under its published conditions: agree to its Commercial Terms, preserve every built-in authentication method and let each user authenticate and pay under their own agreement. This includes end users signing in with their own Claude subscription. That exception does not permit Pavane to collect consumer session/OAuth tokens or route its own API requests through them. Keep CLI-owned subscription integration as a separate candidate requiring protocol, configuration, tool-isolation and Windows qualification. Do not describe every subscription route as forbidden. [Official hosting/authentication conditions](https://code.claude.com/docs/en/legal-and-compliance).

API access and subscription allowances must be labeled separately. Current plan guidance also describes linked Console credits for some plans; do not infer a balance or entitlement from a plan name or model list. [Current plan/API guidance](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan).

## API and account contract

Use only `https://api.anthropic.com`: `GET /v1/models` and `POST /v1/messages`. Send the Console key in sensitive `Authorization: Bearer …`, never a URL. Use `content-type: application/json` and explicit `anthropic-version: 2026-10-21`. `x-api-key` remains a supported legacy fallback; the new slice needs only one authentication path. Keys not scoped to one workspace require `anthropic-workspace-id`; workspace-scoped keys may omit it. An explicit selection must agree with the key. Setup links to the [Console key page](https://platform.claude.com/settings/keys). [API headers and workspace rules](https://platform.claude.com/docs/en/api/overview).

Version 2026-10-21 rejects `temperature`, `top_p` and `top_k` on every model. Omit them and avoid copying older request examples. [Version changes](https://platform.claude.com/docs/en/api/versioning).

Discover active models with the documented lifecycle filter, bounded pages and `has_more`/`last_id` → `after_id` pagination. The omitted lifecycle filter includes deprecated models. Preserve opaque IDs and returned display/capability/output-limit metadata; do not guess current model names or derive capabilities from an ID. Discovery establishes listing access, not successful inference. [Models contract](https://platform.claude.com/docs/en/api/models/list).

Send stateless user/assistant text history ending in the current user input, optional top-level system instructions and a positive bounded `max_tokens`. Honor a known discovered output maximum. No assistant prefill, tools, attachments or automatic continuation in this slice. [Messages request contract](https://platform.claude.com/docs/en/api/messages/create).

## Streaming and cancellation

Parse bounded UTF-8 SSE with indexed block lifecycle and message lifecycle validation. Render text deltas only; keep thinking/signatures separate. Require a final `message_stop`. Message-delta usage is cumulative. Handle a streamed error even after HTTP 200. Ignore pings and harmless unknown protocol extensions; reject malformed, incomplete or unsupported substantive output while preserving text already received. No tool execution. [Streaming protocol](https://platform.claude.com/docs/en/build-with-claude/streaming).

Map `end_turn` and a configured `stop_sequence` to completion; output/context limit stops to truncation; `refusal` to refusal. `tool_use`, `pause_turn` and unknown stop reasons must not become successful plain-text completion. Cancellation stops local consumption; do not promise remote computation or billing stops. [Stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons).

Rate-limit observations and `retry-after` may explain a failure; they do not establish remaining subscription usage or money. Show unknown when authoritative quota is unavailable. No automatic retry, fallback model, workspace or account switch. [Rate limits](https://platform.claude.com/docs/en/api/rate-limits).

## Implementation and acceptance

Reuse the native profile-scoped credential architecture with a distinct Claude target; leave existing Gemini targets readable. Capture key plus workspace selection as one connection identity for catalog and queued runs. Replacement/removal invalidates discovery and prevents queued work silently changing accounts. Keep secret reads native-only, settings write-only/masked, errors redacted, HTTPS origin fixed and redirects/proxies disabled. These are Pavane requirements, not claims about provider guarantees.

Deliver vault/account binding, HTTP transport, catalog/dispatch, picker identity and connection controls together. CI fixtures must cover pagination, key/workspace replacement races, duplicate queued model IDs, fragmented/multibyte SSE, cumulative usage, truncation/refusal/tool stops, midstream errors, missing terminators, bounds and cancellation. Add distinct-provider credential negatives and UI recovery/selection regressions. Independently review persistence/auth and originating product scope before delivery.

Then use one new source-bound CI artifact in the supported Windows lab: serialized empty-profile connection controls, narrow dialog, model-picker/draft retention and synthetic native streams. No paid call, host authentication transfer or local app test is needed. Live account acceptance remains separately unverified. Rollback removes the new adapter/commands/UI without changing SQLite or existing credentials; any Claude credential must be removed explicitly through its supported control before a rollback that removes that control.
