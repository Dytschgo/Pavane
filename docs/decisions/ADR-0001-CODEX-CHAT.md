# Codex subscription transport for text chat

Status: implementation candidate; final lab acceptance pending. Authorized direction: Dylan's request for a working Codex model using an existing subscription. Runtime candidate: `5473ce0`.

Use the installed official Codex app-server over stdio. Keep credentials owned by the CLI; discover models, reasoning, service tiers and usage from its protocol instead of hardcoding account entitlements. Local SQLite remains the conversation source of truth. Send a bounded transcript to a new ephemeral provider thread for each prompt.

The bridge must remain text chat. Disable inherited integrations and execution features per process, verify effective settings, use a read-only/no-network sandbox and deny approval requests. The adapter does not grant general tools or expose a permissions picker. Some CLI versions still advertise patch-tool metadata; do not equate configuration flags with an OS sandbox against a malicious executable. The locally installed CLI is trusted provider software.

Contain Windows provider descendants in private kill-on-close jobs. A waiting launcher host must join its job before starting Codex; its unbuffered startup gate must preserve subsequent JSON input. Keep ownership available during initialization. Bound whole RPC exchanges, output frames and event queues. Retain cleanup ownership through queued responses and cancellation; a rejected turn must not kill sibling chats.

Failures keep saved prompts and partial responses. Timeouts invalidate a broker; the user can refresh discovery to reconnect. Provider limit data can be unavailable and must stay unknown. Provider retention is independent of local expiry. Do not change global Codex settings, provision an API key, or copy private auth files.

Rollback can disable/remove this adapter without a database migration; existing text stays readable. Independent review covers native auth/process/cancellation boundaries. Final acceptance needs the lab Windows flow, including model controls, reload, interrupt and hard-exit cleanup. Protocol compatibility beyond the exercised CLI version needs fresh verification.
