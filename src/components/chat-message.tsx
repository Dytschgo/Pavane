import { lazy, memo, Suspense } from "react";
import { Check, Copy, LoaderCircle } from "lucide-react";
import type { Message, Model } from "../lib/types";
import { Button } from "./ui/button";
import { Tip } from "./ui/tooltip";
import { useCopyFeedback } from "../lib/use-copy-feedback";
import { providerPresentation } from "../lib/provider-presentation";

const Markdown = lazy(() =>
  import("./markdown").then((module) => ({ default: module.Markdown })),
);

export const ChatMessage = memo(function ChatMessage({
  message,
  models,
  onError,
}: {
  message: Message;
  models: Model[];
  onError: (error: unknown) => void;
}) {
  const { copied, copy } = useCopyFeedback(message.content, onError);
  const model = models.find((model) => model.id === message.model);
  const provider =
    model?.provider ??
    (message.model?.startsWith("codex:")
      ? "Codex"
      : message.model?.startsWith("gemini:")
        ? "Gemini"
        : message.model?.startsWith("claude:")
          ? "Claude"
          : "Ollama");
  const ProviderIcon = providerPresentation(provider).chatIcon;
  const name =
    model?.name ?? message.model?.split(":").slice(1).join(":") ?? "Assistant";
  const running = message.status === "pending" || message.status === "running";
  return (
    <article
      className={`message message-${message.role}`}
      aria-label={
        message.role === "user" ? "Your message" : `Response from ${name}`
      }
    >
      {message.role === "assistant" && (
        <div className="message-label">
          <div
            className={`avatar-assistant provider-${provider.toLowerCase()}`}
          >
            <ProviderIcon size={15} />
          </div>
          <strong>{name}</strong>
          <span className="message-provider">{provider}</span>
          {running && (
            <span className="run-status">
              <LoaderCircle className="spin" size={12} />
              {message.status === "pending" ? "Queued" : "Responding"}
            </span>
          )}
        </div>
      )}
      <div className="message-content">
        {message.content ? (
          message.role === "assistant" ? (
            <Suspense
              fallback={
                <span className="plain-response">{message.content}</span>
              }
            >
              <Markdown content={message.content} />
            </Suspense>
          ) : (
            message.content
          )
        ) : running ? (
          <span className="thinking-dots" aria-label="Waiting for response">
            ···
          </span>
        ) : (
          <span className="muted">No response text.</span>
        )}
      </div>
      {["failed", "cancelled", "interrupted"].includes(message.status) && (
        <div className="message-outcome">
          {message.status === "interrupted"
            ? "Interrupted when Pavane closed. Partial text was saved."
            : message.status === "cancelled"
              ? "Stopped. Partial text was saved."
              : "Response failed. Your message is saved."}
        </div>
      )}
      {message.content && (
        <Tip label={copied ? "Copied" : "Copy message"}>
          <Button
            variant="ghost"
            size="icon"
            className="copy-message"
            aria-label="Copy message"
            onClick={() => void copy()}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </Button>
        </Tip>
      )}
    </article>
  );
});
