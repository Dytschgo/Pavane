# Gemini ACP transport

The Gemini wire layer is implemented in `src-tauri/src/gemini.rs` and exported by the Rust library. It is not connected to Tauri commands, provider discovery, the model picker or a CLI launcher. There is no working Gemini connection yet. The [provider audit](PROVIDER-CONNECTIONS.md) and [ADR-0002](decisions/ADR-0002-PROVIDER-CONNECTIONS.md) still require proof of a real CLI launch profile before catalog exposure.

## Implemented boundary

A connection handles initialization, one session and at most one text prompt. It advertises no file or terminal capabilities, never calls authenticate, and has no process-spawning or credential-reading code. The caller supplies an already qualified transport and remains responsible for its owned process scope. An empty session MCP list is not treated as an isolation control.

Replies must match the outstanding numeric request ID. Session updates must match the exact session. Server requests are detected before replies, denied and stopped even when the IDs collide. Only assistant text reaches the callback; thought/echo text is discarded. Tool activity, unsupported content and unknown notification types fail closed. Provider error bodies are replaced with a generic error rather than exposing raw diagnostics.

Limits: 256 KiB per incoming frame, 512 KiB serialized request, 256 KiB prompt context, 2 MiB delivered output, 32 MiB cumulative wire data, 65,536 updates, and 32 buffered pre-session updates. No request map or background reader task is allocated. Setup has a 10-second deadline, writes five seconds and a prompt 900 seconds. These are protective ceilings, not speed or memory measurements.

Stop sends `session/cancel` for the exact session and allows two seconds for a terminal reply. A `cancelled` stop reason is an acknowledgement, not cleanup proof. A peer that remains open without acknowledging produces an explicit unacknowledged cancellation. Read fragments survive cancellation so the same stream can be drained. If any write was interrupted, no more frames are appended. Connections are not reused after a prompt, failure or dropped setup future. Callback failures remain errors during normal delivery and cancellation draining; the transport makes no SQLite persistence claim.

## Authored checks and review

Fifteen duplex-peer tests cover text-only capability negotiation, fragmented Unicode, assistant/thought/echo routing, dropped initialization, colliding request IDs, wrong versions/replies, redacted provider failures, malformed/oversized/unterminated frames, foreign sessions, tool/nontext/unknown updates, early text and setup flooding, partial callback delivery before disconnect/token limits, cancellation with a partially read frame, elapsed cancellation timeout against a still-open peer, interrupted prompt/denial writes, callback/protocol errors during cancellation, normal callback failure and actual streaming past the output limit.

Independent read-only standards/spec review found no standards findings and two cancellation blockers: a partial denial write could be followed by a cancel frame, and callback errors during cancellation were hidden. Root corrected both with write-in-progress tracking, error propagation and targeted regressions. Root also tightened dropped-setup reuse and made the fragment test trigger cancellation after bytes actually enter the reader. Follow-up changes were source-inspected, not independently re-reviewed. No tests have run on the coding PC; CI execution is pending. The reviewer ran no providers, builds, UI or LabManager calls.

The suite proves only the wire boundary when it passes. It cannot establish actual CLI isolation, auth ownership, account entitlement, model selection, history replay, session storage/expiry or process cleanup. Setup/write/full-turn elapsed deadlines and cumulative wire/update exhaustion are source-bounded but not separately exercised by these fixtures. The actual two-second cancellation deadline is exercised.

## Integration and rollback

Next, qualify an exact published Gemini CLI version and supported launch controls in CI with disposable configuration and no real account. The audit's pinned main source identifies a nightly version; it must not be mistaken for an installed or qualified release. Prove inherited MCP/hooks/extensions/context behavior is suppressed while respecting centrally managed restrictions and leaving credentials with the CLI. Add process-ownership/cancellation evidence and independent native/auth review, then wire the provider and exercise its actual changed UI path in the lab. No auto-installation, login, host auth transfer or paid inference is implied. If supported controls cannot meet the contract, record the result and take PV-KEYS-001.

This slice exceeds 500 lines because the bounded transport and its failure fixtures belong together; it introduces no generic agent launcher, dependency, schema, provider configuration or existing chat behavior change. Rollback removes the new module/export and its documentation, leaving current Codex/Ollama, SQLite and accepted test executable unchanged.
