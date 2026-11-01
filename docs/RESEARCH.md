# Research basis — 29 October 2026

Historical initial research follows. Codex has since been implemented and independently exercised; see [verification](VERIFICATION.md). The [31 October provider audit](PROVIDER-CONNECTIONS.md) supersedes the unresolved Claude/Gemini/Grok interface findings below with current official documentation and pinned source inspection. Additional adapters remain unimplemented.

Two Luna (`gpt-6-luna`, medium effort) research tasks ran in parallel, read-only. The coordinator inspected their reports and the implementation sources. No T3 code was copied, and research did not make provider calls or read auth files.

## T3 patterns

Local T3 Code revision inspected: `519d64f6cec0a0f9ed18fbca4a3f8695cac44506`. Its source checkout identifies MIT licensing. Useful patterns include bounded history in `apps/server/src/orchestration-v2/threadHistoryPaging.ts`, bounded stream replay in `ThreadStream.ts`, coalescing in `ThreadLiveEventCoalescer.ts`, explicit budgets in `LiveStreamBudget.ts`, provider metadata in `ProviderAdapterRegistry.ts`, and lightweight renderer/sidebar state in `apps/web/src/uiStateStore.ts` and `threadSelectionStore.ts`.

Pavane adapts the principles with message/byte budgets, separate SQLite summaries and history, native queue limits, partial checkpoints and coalesced IPC. This is architectural inspection, not a benchmark or a promise to reproduce every T3 feature. A Rust desktop app also has different process/runtime costs from T3's Electron/server architecture.

## Provider feasibility

[Codex app-server](https://learn.chatgpt.com/docs/app-server) documents a local structured protocol with initialization, model and account APIs, thread/turn lifecycle, events and interruption. It is the next candidate for a supported subscription bridge. The research did not establish a complete tool-free isolation profile for Pavane, so it is not exposed as a working connection in this version. Authentication, actual limits and successful model access must be verified separately. No provider's model list proves account entitlement.

The bounded research checked [Claude Code's setup documentation](https://docs.anthropic.com/en/docs/claude-code/getting-started), [Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key) and [Gemini API CLI](https://ai.google.dev/gemini-api/docs/cli). It did not establish complete general-chat subscription adapters or reliable quota APIs for Claude, Gemini or Grok. These are open implementation questions, not evidence that integration is impossible. A future adapter must verify primary documentation and the relevant local provider protocol at implementation time.

The working local adapter follows Ollama's documented [model listing](https://docs.ollama.com/api/tags) and [streamed chat](https://docs.ollama.com/api/chat). This first slice deliberately needs no subscription token or API key. A selected local model can have substantial independent compute and RAM requirements.

The full worker reports remain in the originating T3 thread's delegated-task results. Claims in this repository are limited to the reviewed sources and behavior implemented here.
