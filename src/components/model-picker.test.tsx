import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelPicker } from "./model-picker";
import { TooltipProvider } from "./ui/tooltip";
import type { Preferences } from "../lib/model-preferences";
import type { Model } from "../lib/types";

const models: Model[] = [
  {
    id: "codex:sol",
    name: "Sol",
    provider: "Codex",
    reasoningEfforts: ["low", "high"],
    defaultReasoningEffort: "low",
    serviceTiers: [
      { id: "priority", name: "Fast", description: "Provider-reported tier" },
    ],
  },
  { id: "ollama:local", name: "Local", provider: "Ollama" },
];
function Harness() {
  const [preferences, update] = useState<Preferences>({
    selected: ["codex:sol"],
    favourites: [],
    options: {},
    compare: false,
  });
  const [open, setOpen] = useState(true);
  return (
    <TooltipProvider>
      <ModelPicker
        models={models}
        preferences={preferences}
        update={update}
        open={open}
        onOpenChange={setOpen}
        connecting={false}
        onRefresh={() => {}}
        onConnect={() => {}}
      />
    </TooltipProvider>
  );
}
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("filters with the keyboard, stars a result and chooses it without extra setup", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const search = await screen.findByRole("combobox", { name: "Search models" });
  await user.type(search, "Local");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  await user.keyboard("{Control>}d{/Control}");
  expect(screen.getByRole("button", { name: "Unstar Local" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await user.keyboard("{Enter}");
  await waitFor(() =>
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("button", { name: "Model: Local. Change model" }),
  ).toBeInTheDocument();
});

it("opens supported reasoning options from the keyboard and applies the choice", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const search = await screen.findByRole("combobox", { name: "Search models" });
  await user.click(search);
  await user.keyboard("{ArrowRight}");
  const high = await screen.findByRole("radio", { name: "High" });
  expect(screen.getByRole("radio", { name: /^Fast/ })).toBeInTheDocument();
  await user.click(high);
  expect(
    screen.getByRole("button", { name: "Model: Sol, High. Change model" }),
  ).toBeInTheDocument();
});
