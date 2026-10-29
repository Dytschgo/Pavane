import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Markdown } from "./markdown";
import { TooltipProvider } from "./ui/tooltip";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("renders useful Markdown while blocking raw HTML, script links and remote images", () => {
  const { container } = render(
    <TooltipProvider>
      <Markdown
        content={
          '## A useful answer\n\n- First point\n- Second point\n\n```rust\nfn main() {}\n```\n\n[unsafe](javascript:alert(1))\n\n![Remote image](https://example.invalid/tracker.png)\n\n<script>window.stolen=true</script>\n<img src="https://example.invalid/track" onerror="alert(1)" />'
        }
      />
    </TooltipProvider>,
  );
  expect(
    screen.getByRole("heading", { name: "A useful answer" }),
  ).toBeInTheDocument();
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Copy code" })).toBeInTheDocument();
  expect(container.querySelector("pre code")).toHaveTextContent("fn main() {}");
  expect(container.querySelector("img,script,iframe")).toBeNull();
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
});

it("keeps a streaming table's DOM and horizontal scroll position", async () => {
  const wrap = (content: string) => (
    <TooltipProvider>
      <Markdown content={content} />
    </TooltipProvider>
  );
  const start = "| Item | Detail |\n| --- | --- |\n| First | wide value |";
  const { container, rerender } = render(wrap(start));
  const table = container.querySelector<HTMLDivElement>(".table-scroll")!;
  table.scrollLeft = 85;
  rerender(wrap(start + "\n| Second | new value |"));
  await screen.findByText("Second");
  expect(container.querySelector(".table-scroll")).toBe(table);
  expect(table.scrollLeft).toBe(85);
});

it("only labels code Copied while the clipboard snapshot matches the streamed text", async () => {
  const user = userEvent.setup();
  const write = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockResolvedValue(undefined);
  const wrap = (content: string) => (
    <TooltipProvider>
      <Markdown content={content} />
    </TooltipProvider>
  );
  const { rerender } = render(wrap("```js\nconst first = 1;\n```"));
  await user.click(screen.getByRole("button", { name: "Copy code" }));
  await screen.findByText("Copied");
  rerender(wrap("```js\nconst first = 1;\nconst second = 2;\n```"));
  await waitFor(() =>
    expect(screen.queryByText("Copied")).not.toBeInTheDocument(),
  );
  await user.click(screen.getByRole("button", { name: "Copy code" }));
  expect(write).toHaveBeenLastCalledWith("const first = 1;\nconst second = 2;");
  write.mockRestore();
});
