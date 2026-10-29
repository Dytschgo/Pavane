import { memo, useDeferredValue, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, ImageOff, Link2 } from "lucide-react";
import { Button } from "./ui/button";
import { Tip } from "./ui/tooltip";
import { api } from "../lib/api";
import { useCopyFeedback } from "../lib/use-copy-feedback";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node)
    return textOf((node.props as { children?: ReactNode }).children);
  return "";
}
function CodeBlock({ children }: ComponentProps<"pre">) {
  const { copied, copy } = useCopyFeedback(textOf(children).replace(/\n$/, ""));
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
          onClick={() => void copy()}
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
  const { copied, copy } = useCopyFeedback(href ?? "");
  const [failedHref, setFailedHref] = useState<string | null>(null);
  const failed = failedHref === href;
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
          if (failed) void copy();
          else void api.openExternal(href).catch(() => setFailedHref(href));
        }}
      >
        {children}
        <Link2 size={11} className="inline-link-icon" />
      </a>
    </Tip>
  );
}

function BlockedImage({ alt }: ComponentProps<"img">) {
  return (
    <span className="blocked-image">
      <ImageOff size={14} />
      {alt || "Image"}
    </span>
  );
}
function MarkdownTable({ children }: ComponentProps<"table">) {
  return (
    <div className="table-scroll">
      <table>{children}</table>
    </div>
  );
}
const components: Components = {
  pre: CodeBlock,
  a: SafeLink,
  img: BlockedImage,
  table: MarkdownTable,
};
const plugins = [remarkGfm];

export const Markdown = memo(function Markdown({
  content,
}: {
  content: string;
}) {
  const deferred = useDeferredValue(content);
  return (
    <div className="markdown">
      <ReactMarkdown skipHtml remarkPlugins={plugins} components={components}>
        {deferred}
      </ReactMarkdown>
    </div>
  );
});
