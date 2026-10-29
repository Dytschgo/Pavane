export type View =
  "chat" | "projects" | "spaces" | "bots" | "images" | "videos";
export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  workspaceId: string | null;
}
export interface Message {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  status:
    "pending" | "running" | "complete" | "cancelled" | "interrupted" | "failed";
  createdAt: number;
  sequence: number;
}
export interface Workspace {
  id: string;
  kind: "projects" | "spaces" | "bots";
  name: string;
  instructions: string;
}
export interface Model {
  id: string;
  name: string;
  provider: string;
  reasoningEfforts?: string[];
  defaultReasoningEffort?: string | null;
  serviceTiers?: { id: string; name: string; description: string }[];
  isDefault?: boolean;
  description?: string;
}
export interface ModelOptions {
  reasoningEffort?: string | null;
  serviceTier?: string | null;
}
export interface ProviderStatus {
  id: string;
  name: string;
  state: string;
  detail: string;
  limits: {
    label: string;
    usedPercent: number;
    resetsAt: number | null;
    windowMinutes: number | null;
  }[];
}
export interface Catalog {
  models: Model[];
  providers: ProviderStatus[];
}
export interface Run {
  id: string;
  chatId: string;
  messageId: string;
  model: string;
}
export interface RunEvent {
  runId: string;
  chatId: string;
  messageId: string;
  kind: "status" | "delta" | "finished";
  delta: string;
  status: Message["status"];
  error: string | null;
}
export interface TurnStarted {
  user: Message;
  runs: Run[];
}

export function daysRemaining(deadline: number, now = Date.now()) {
  return Math.max(0, Math.ceil((deadline - now) / 86_400_000));
}

export function applyRunEvent(messages: Message[], event: RunEvent): Message[] {
  return messages.map((message) =>
    message.id === event.messageId
      ? {
          ...message,
          content: message.content + event.delta,
          status: event.status,
        }
      : message,
  );
}
