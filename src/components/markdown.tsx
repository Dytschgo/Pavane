import { memo, useDeferredValue, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, ImageOff, Link2 } from "lucide-react";
import { Button } from "./ui/button";
import { Tip } from "./ui/tooltip";
import { api } from "../lib/api";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node)
    return textOf((node.props as { children?: ReactNode }).children);
  return "";
}
function CodeBlock({ children }: ComponentProps<"pre">) {
  const [copied, setCopied] = useState(false);
  const element = Array.isArray(children) ? children[0] : children;
  const language =
    element && typeof element === "object" && "props" in element
      ? String(
          (element.props as { className?: string }).className ?? "",
        ).replace("language-", "")
      : "";
  return (
    <div className="code-block">
      <div className="code-header">
        <span>{language || "Code"}</span>
        <Button
          variant="ghost"
          size="small"
          aria-label="Copy code"
          onClick={() => {
            void navigator.clipboard
              .writeText(textOf(children).replace(/\n$/, ""))
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </Button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}
function SafeLink({ href, children }: ComponentProps<"a">) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!href || !/^https?:\/\//i.test(href)) return <span>{children}</span>;
  return (
    <Tip
      label={
        copied
          ? "Link copied"
          : failed
            ? "Could not open. Click to copy link."
            : `${href} · Open in your browser`
      }
    >
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          if (failed)
            void navigator.clipboard
              .writeText(href)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          else void api.openExternal(href).catch(() => setFailed(true));
        }}
      >
        {children}
        <Link2 size={11} className="inline-link-icon" />
      </a>
    </Tip>
  );
}

export const Markdown = memo(function Markdown({
  content,
}: {
  content: string;
}) {
  const deferred = useDeferredValue(content);
  return (
    <div className="markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          pre: CodeBlock,
          a: SafeLink,
          img: ({ alt }) => (
            <span className="blocked-image">
              <ImageOff size={14} />
              {alt || "Image"}
            </span>
          ),
          table: ({ children }) => (
            <div className="table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {deferred}
      </ReactMarkdown>
    </div>
  );
});
