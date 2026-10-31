import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Message, Model } from "../lib/types";
import { ChatMessage } from "./chat-message";
import { TooltipProvider } from "./ui/tooltip";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("offers draft reuse only for a nonempty user prompt and preserves copy", async () => {
  const onReuse = vi.fn();
  const user = userEvent.setup();
  const writeText = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockResolvedValue(undefined);
  const message: Message = { ...reply, role: "user", model: null };
  const view = (value: Message, disabled = false) => (
    <TooltipProvider>
      <ChatMessage
        message={value}
        models={[]}
        onError={vi.fn()}
        onReuse={onReuse}
        reuseDisabled={disabled}
      />
    </TooltipProvider>
  );
  const { rerender } = render(view(message));
  expect(screen.getByRole("button", { name: "Copy message" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Copy message" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(message.content));
  fireEvent.click(screen.getByRole("button", { name: "Add prompt to draft" }));
  expect(onReuse).toHaveBeenCalledTimes(1);
  expect(onReuse).toHaveBeenCalledWith(message);
  rerender(view(message, true));
  expect(
    screen.getByRole("button", { name: "Add prompt to draft" }),
  ).toBeDisabled();
  rerender(view(reply));
  await screen.findByText(reply.content);
  expect(
    screen.queryByRole("button", { name: "Add prompt to draft" }),
  ).toBeNull();
  rerender(view({ ...message, content: "" }));
  expect(
    screen.queryByRole("button", { name: "Add prompt to draft" }),
  ).toBeNull();
});

const reply: Message = {
  id: "saved-reply",
  chatId: "saved-chat",
  role: "assistant",
  content: "A saved response remains available.",
  model: "gemini:gemini-test",
  status: "complete",
  createdAt: 1,
  sequence: 1,
};

it("offers Stop before the first text and leaves status authoritative until a native update", async () => {
  let complete!: () => void;
  const onStop = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const pending: Message = { ...reply, content: "", status: "pending" };
  const view = (message: Message) => (
    <TooltipProvider>
      <ChatMessage
        message={message}
        models={[]}
        onError={vi.fn()}
        onStop={onStop}
      />
    </TooltipProvider>
  );
  const { rerender } = render(view(pending));
  const button = screen.getByRole("button", { name: "Stop this response" });
  fireEvent.click(button);
  expect(onStop).toHaveBeenCalledWith(pending);
  expect(button).toBeDisabled();
  expect(screen.getByText("Queued")).toBeInTheDocument();
  expect(screen.queryByText("Stopped. Partial text was saved.")).toBeNull();
  await act(async () => {
    complete();
  });
  await waitFor(() => expect(button).toBeEnabled());
  rerender(
    view({ ...pending, status: "cancelled", content: "Kept partial text" }),
  );
  expect(
    screen.queryByRole("button", { name: "Stop this response" }),
  ).toBeNull();
  expect(await screen.findByText("Kept partial text")).toBeInTheDocument();
});

it("reports a failed Stop request and leaves partial text available for another attempt", async () => {
  const error = new Error("Synthetic stop failure");
  const onError = vi.fn();
  const onStop = vi.fn().mockRejectedValue(error);
  render(
    <TooltipProvider>
      <ChatMessage
        message={{ ...reply, status: "running" }}
        models={[]}
        onError={onError}
        onStop={onStop}
      />
    </TooltipProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Stop this response" }));
  await waitFor(() => expect(onError).toHaveBeenCalledWith(error));
  expect(
    screen.getByRole("button", { name: "Stop this response" }),
  ).toBeEnabled();
  expect(await screen.findByText(reply.content)).toBeInTheDocument();
});

it("keeps the Gemini identity when its model disappears from discovery", async () => {
  const onError = vi.fn();
  const view = (models: Model[]) => (
    <TooltipProvider>
      <ChatMessage message={reply} models={models} onError={onError} />
    </TooltipProvider>
  );
  const { rerender } = render(
    view([
      { id: "gemini:gemini-test", name: "Test text model", provider: "Gemini" },
    ]),
  );
  expect(screen.getByText("Gemini")).toBeInTheDocument();
  rerender(view([]));
  expect(screen.getByText("Gemini")).toBeInTheDocument();
  expect(screen.queryByText("Ollama")).toBeNull();
  expect(await screen.findByText(reply.content)).toBeInTheDocument();
  expect(onError).not.toHaveBeenCalled();
});

it.each([
  ["gemini:gemini-test", "Gemini"],
  ["claude:opaque-model-id", "Claude"],
  ["xai:opaque-model-id", "xAI"],
  ["codex:sol", "Codex"],
  ["ollama:test", "Ollama"],
])(
  "identifies a saved %s reply before any catalog loads",
  async (model, provider) => {
    render(
      <TooltipProvider>
        <ChatMessage
          message={{ ...reply, model }}
          models={[]}
          onError={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText(provider)).toBeInTheDocument();
    expect(await screen.findByText(reply.content)).toBeInTheDocument();
  },
);
