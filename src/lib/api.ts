import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type {
  Chat,
  Message,
  Model,
  RunEvent,
  TurnStarted,
  Workspace,
  Catalog,
  ModelOptions,
} from "./types";

export const native = isTauri();

function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!native)
    return Promise.reject(
      new Error(
        "Open the desktop app to save chats and connect models. Run pnpm desktop.",
      ),
    );
  return invoke<T>(command, args);
}

export const api = {
  listChats: (offset = 0, search = "") =>
    call<Chat[]>("list_chats", { offset, search }),
  createChat: (deleteSoon = false, workspaceId: string | null = null) =>
    call<Chat>("create_chat", { deleteSoon, workspaceId }),
  messages: (chatId: string, before: number | null = null) =>
    call<{ items: Message[]; hasMore: boolean }>("get_messages", {
      chatId,
      before,
    }),
  draft: (chatId: string) => call<string>("get_draft", { chatId }),
  saveDraft: (chatId: string, content: string) =>
    call<void>("save_draft", { chatId, content }),
  rename: (chatId: string, title: string) =>
    call<void>("rename_chat", { chatId, title }),
  keep: (chatId: string) => call<void>("keep_chat", { chatId }),
  delete: (chatId: string) => call<void>("delete_chat", { chatId }),
  stop: (chatId: string) => call<void>("stop_chat", { chatId }),
  workspaces: () => call<Workspace[]>("list_workspaces"),
  createWorkspace: (kind: string, name: string, instructions: string) =>
    call<Workspace>("create_workspace", { kind, name, instructions }),
  workspace: (id: string) => call<Workspace>("get_workspace", { id }),
  updateWorkspace: (expected: Workspace, name: string, instructions: string) =>
    call<Workspace>("update_workspace", { expected, name, instructions }),
  models: () => call<Model[]>("discover_models"),
  openExternal: (url: string) => call<void>("open_external_url", { url }),
  catalog: () => call<Catalog>("discover_providers"),
  saveGeminiKey: (key: string) => call<void>("save_gemini_key", { key }),
  removeGeminiKey: () => call<void>("remove_gemini_key"),
  saveXaiKey: (key: string) => call<void>("save_xai_key", { key }),
  removeXaiKey: () => call<void>("remove_xai_key"),
  saveClaudeConnection: (key: string, workspace: string | null) =>
    call<void>("save_claude_connection", { key, workspace }),
  removeClaudeConnection: () => call<void>("remove_claude_connection"),
  send: (
    chatId: string,
    content: string,
    models: string[],
    receive: (event: RunEvent) => void,
    options: Record<string, ModelOptions> = {},
  ) => {
    const onEvent = new Channel<RunEvent>();
    onEvent.onmessage = receive;
    return call<TurnStarted>("send_message", {
      chatId,
      content,
      models,
      onEvent,
      options,
    });
  },
};

export function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "Something went wrong. Please try again.";
}
