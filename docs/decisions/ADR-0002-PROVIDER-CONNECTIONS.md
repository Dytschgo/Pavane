# ADR-0002 — Prove an isolated provider bridge before exposing it

Status: superseded by [ADR-0003](ADR-0003-GEMINI-API.md) after the provider eligibility correction. Retained rationale below is historical, not an instruction to resume the consumer CLI route.

Pavane needs additional model providers while keeping text chat free of autonomous tools and leaving subscription credentials with their owner. The prior provider research did not settle supported interfaces. The current [provider audit](../PROVIDER-CONNECTIONS.md) found official Gemini and Grok ACP surfaces, API-key guidance for third-party Claude applications, and configuration inheritance that an empty client MCP list does not remove.

Start with Gemini's supported local CLI protocol and prove a child-only launch profile before placing its models in the ready catalog. Preserve centrally managed policy; do not copy auth, modify user settings, launch an authentication browser or run inference as a discovery side effect. Require actual CLI isolation evidence alongside transport negative tests and independent review. Leave unsupported capability/quota data unknown. The audit contains the concrete acceptance criteria and source pins.

This keeps the desired subscription workflow as a candidate without claiming that ACP itself prevents inherited tools or that consumer plans grant API access. It also delays a visible connection until failure, cancellation, storage and process ownership are bounded. If the supported CLI cannot meet the contract, record that outcome and take the separately tracked Windows-protected API-key route. No paid API usage or setup is authorized by this decision.

Claude and Grok remain planned. Current Codex/Ollama behavior and existing data are unchanged. Rollback removes the new provider implementation/pointers while preserving saved conversations and existing provider configuration; code rollback cannot undo provider-side data already sent by a future implemented connection.
