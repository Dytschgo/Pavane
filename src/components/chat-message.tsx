import { lazy, memo, Suspense, useState } from "react";
import {
  AudioLines,
  Check,
  Copy,
  LoaderCircle,
  SquareTerminal,
} from "lucide-react";
import type { Message, Model } from "../lib/types";
import { Button } from "./ui/button";
import { Tip } from "./ui/tooltip";

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
  const [copied, setCopied] = useState(false);
  const model = models.find((model) => model.id === message.model);
  const provider =
    model?.provider ??
    (message.model?.startsWith("codex:") ? "Codex" : "Ollama");
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
            {provider === "Codex" ? (
              <SquareTerminal size={15} />
            ) : (
              <AudioLines size={15} />
            )}
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
            onClick={() => {
              void navigator.clipboard
                .writeText(message.content)
                .then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                })
                .catch(onError);
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </Button>
        </Tip>
      )}
    </article>
  );
});
