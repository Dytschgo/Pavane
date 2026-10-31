import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Message, Model } from "../lib/types";
import { ChatMessage } from "./chat-message";
import { TooltipProvider } from "./ui/tooltip";

afterEach(cleanup);

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
