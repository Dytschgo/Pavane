# Claude API connection

The Console-key/workspace adapter is authored under PV-CLAUDE-API-001. Initial CI0e609ad passed formatting/lint and failed TypeScript on the picker empty state’s missing Cpu import. That single import is restored; subsequent checks/tests/build and changed native UI acceptance remain pending. The tested unsigned app remains the separately accepted 942e87a build. No real Claude credential, CLI authentication, provider call or billed inference was used in development. [Researched contract and official sources](CLAUDE-CONNECTION-PLAN.md).

## User workflow

Open Connections, paste a new Claude Console API key, optionally enter the workspace ID required by an unscoped key, then save the connection. Both values replace together; editing requires resubmitting the key. Inputs clear after a successful save/removal and IPC failures show generic recovery text. Refresh discovers actual API models in a distinct Claude picker rail. Discovery is not inference entitlement. A missing/disconnected saved selection stays unavailable rather than silently switching models.

This is the direct API route, with API usage/billing and unknown account quota. The documented unmodified Claude Code subscription route remains a separate qualification candidate. This slice does not collect consumer credentials or use a subscription token for direct HTTP.

## Native identity and recovery

ClaudeCredential owns the key and optional workspace; it is neither cloneable nor serializable and its Debug output is redacted. The native-only ClaudeVault stores one bounded, versioned PVC1 envelope in Windows Credential Manager at Pavane/Claude/v1 plus the canonical profile path. Its maximum encoded size is 2,183 bytes. Gemini retains its original Pavane/Gemini/v1 target and plain-key decoder; no credential or SQLite migration occurs. Provider/profile isolation and cross-provider deletion are explicit regression cases.

Shared private OS helpers keep synchronous credential calls/read-buffer disposal under the existing process-wide mutex. No HTTP or await holds that mutex. Owned key/envelope/header assembly buffers are wiped on a best-effort basis; renderer strings, OS/HTTP/IPC transient copies and other processes are outside that guarantee. Non-Windows storage fails explicitly. There is no arbitrary vault-target parameter or secret getter in Tauri.

Discovery is bound to connection bytes, workspace, local revision and request generation. Each accepted run, including duplicate selected model IDs, receives its own native connection snapshot. Queued work rechecks identity/catalog before HTTP and fails if the key or workspace changed; requests already sent may finish under the original connection. Removal invalidates new requests and refreshes only that provider in the renderer. It does not cancel or revoke an already-sent remote request.

## HTTP and text handling

The adapter uses only api.anthropic.com, HTTPS, sensitive Bearer authentication, explicit version 2026-10-21 and the optional workspace header. Redirects, proxy inheritance and retries are disabled. Discovery follows at most five pages/200 models, bounds each response and rejects malformed/repeated pagination. IDs remain opaque; active lifecycle metadata is honored without guessing model families. Output is bounded to the smaller of 4,096 tokens and a known positive discovered maximum. No reasoning, service-tier, temperature/top-p/top-k, tools or automatic continuation are exposed.

Requests send native SQLite text context and optional workspace instructions. SSE validates UTF-8, event/type agreement, indexed block/message order, event/wire/output bounds and the final message_stop. Only text is rendered; known thinking/signature blocks are excluded, and unsupported content fails with partial text retained. Output/context limits, refusal, tool continuation, malformed frames, streamed errors or an incomplete stream are failures with specific generic explanations, not successful completion. No stop sequence is configured. Cumulative usage is not summed or exposed as remaining quota. Stop drops local HTTP consumption without promising provider-side billing cancellation.

## Verification and rollback

Authored regressions cover headers/workspace/version, opaque model IDs/pagination, stateless context and output limits, fragmented Unicode/CRLF, partial/incomplete/error responses, stop reasons, thinking/tool separation, malformed lifecycle, cancellation/disconnection and real persisted duplicate-run snapshot assignment. Windows disposable-target cases cover atomic replacement/reopen, profile/provider separation, invalid/corrupt/version/oversize data and cleanup. Manager fixtures cover missing-key/no-network and connection replacement during discovery/after queueing. Renderer cases cover masked atomic setup, validation/recovery, provider-specific invalidation, picker selection and offline saved reply identity.

The changed native fixture scrolls the fourth connection into view at the existing narrow size, checks key/workspace validation without saving either, removes only the fresh profile's absent Claude target and captures native-claude-validation.png and native-claude-connection.png. The verifier exports that allowlisted image through its existing finally path. This is planned empty-profile/native-IPC proof; it cannot establish real account setup, model access or inference. Do not execute app/tests/build/UI/vault/provider checks on Dylan's working PC. Use CI, then one supported source-bound Windows lab turn after green checks.

The vault, manager, dispatch, renderer and regression changes form one connection despite the review-size threshold. Splitting out unused storage would leave unreviewable credentials without a user removal path. No schema/dependency/package-version upgrade is required. Independent Standards review reported zero material findings. Spec review reported one low-priority metadata-scope finding, resolved by clarifying the text-only contract without adding unused fields. Follow-up edits are source-inspected, not independently re-reviewed. Rollback removes the Claude adapter/commands/UI while preserving chats, Gemini credentials and existing providers. Remove any saved Claude credential through its supported control before rolling back that control; no broad credential cleanup is authorized.

Small post-review refinements add two narrow native captures and reject a malformed late message_delta with a partial-text regression. They were directly source-inspected, not independently re-reviewed or executed locally.
