import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type {
  Chat,
  Message,
  Model,
  RunEvent,
  TurnStarted,
  Workspace,
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
  models: () => call<Model[]>("discover_models"),
  send: (
    chatId: string,
    content: string,
    models: string[],
    receive: (event: RunEvent) => void,
  ) => {
    const onEvent = new Channel<RunEvent>();
    onEvent.onmessage = receive;
    return call<TurnStarted>("send_message", {
      chatId,
      content,
      models,
      onEvent,
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
