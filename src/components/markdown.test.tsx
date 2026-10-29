import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Markdown } from "./markdown";
import { TooltipProvider } from "./ui/tooltip";

afterEach(cleanup);
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
