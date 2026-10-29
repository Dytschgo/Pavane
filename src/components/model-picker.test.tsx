import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
function Harness({
  initial,
  catalog = models,
  onSelected,
}: {
  initial?: Partial<Preferences>;
  catalog?: Model[];
  onSelected?: () => void;
}) {
  const [preferences, update] = useState<Preferences>({
    selected: ["codex:sol"],
    favourites: [],
    options: {},
    compare: false,
    ...initial,
  });
  const [open, setOpen] = useState(true);
  return (
    <TooltipProvider>
      <ModelPicker
        models={catalog}
        preferences={preferences}
        update={update}
        open={open}
        onOpenChange={setOpen}
        connecting={false}
        onRefresh={() => {}}
        onConnect={() => {}}
        onSelected={onSelected}
      />
    </TooltipProvider>
  );
}
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

it("clears a completed search and highlights the chosen model when reopened", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.type(await screen.findByRole("combobox"), "Local");
  await user.keyboard("{Enter}");
  await user.click(
    await screen.findByRole("button", { name: "Model: Local. Change model" }),
  );
  const search = await screen.findByRole("combobox");
  expect(search).toHaveValue("");
  expect(screen.getAllByRole("option")).toHaveLength(2);
  expect(
    document.getElementById(search.getAttribute("aria-activedescendant")!),
  ).toHaveTextContent("Local");
  await user.keyboard("{Enter}");
  expect(
    screen.getByRole("button", { name: "Model: Local. Change model" }),
  ).toBeInTheDocument();
});

it("keeps search scoped to the selected provider and offers filter recovery", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(await screen.findByRole("button", { name: "Ollama" }));
  await user.type(screen.getByRole("combobox"), "Codex");
  expect(screen.queryAllByRole("option")).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Ollama" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getAllByRole("option")).toHaveLength(2);
  expect(screen.getByRole("combobox")).toHaveValue("");
});

it("selects a favourite with its shortcut, closes compare mode and hands focus back", async () => {
  const user = userEvent.setup();
  const selected = vi.fn();
  render(
    <Harness
      initial={{ favourites: ["ollama:local"], compare: true }}
      onSelected={selected}
    />,
  );
  await screen.findByRole("combobox");
  expect(screen.getByRole("option", { name: /Local/ })).toHaveAttribute(
    "aria-keyshortcuts",
    "Control+1",
  );
  await user.keyboard("{Control>}1{/Control}");
  await waitFor(() => expect(selected).toHaveBeenCalledTimes(1));
  const trigger = screen.getByRole("button", {
    name: "Model: Local. Change model",
  });
  await user.click(trigger);
  expect(
    await screen.findByRole("button", { name: /Compare models/ }),
  ).toHaveAttribute("aria-pressed", "false");
});

it("preserves input editing and IME composition before opening reasoning", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const search = await screen.findByRole("combobox");
  await user.type(search, "Sol");
  fireEvent.keyDown(search, { key: "Enter", isComposing: true });
  expect(search).toBeInTheDocument();
  (search as HTMLInputElement).setSelectionRange(0, 0);
  await user.keyboard("{ArrowRight}");
  expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  (search as HTMLInputElement).setSelectionRange(3, 3);
  await user.keyboard("{ArrowRight}");
  expect(
    await screen.findByRole("radiogroup", { name: "Reasoning for Sol" }),
  ).toBeInTheDocument();
});

it("scrolls the active option into view as keyboard navigation passes the initial page", async () => {
  const user = userEvent.setup();
  const scrolled: string[] = [];
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this.id);
  });
  const catalog = Array.from({ length: 20 }, (_, index) => ({
    id: `ollama:${index}`,
    name: `Local ${index}`,
    provider: "Ollama",
  }));
  render(<Harness catalog={catalog} initial={{ selected: ["ollama:0"] }} />);
  const search = await screen.findByRole("combobox");
  for (let index = 0; index < 12; index++) await user.keyboard("{ArrowDown}");
  const active = search.getAttribute("aria-activedescendant");
  expect(document.getElementById(active!)).toHaveTextContent("Local 12");
  expect(scrolled.at(-1)).toBe(active);
});

it("shows supported fallback settings and makes an active fast tier visible", async () => {
  const user = userEvent.setup();
  render(
    <Harness
      initial={{
        options: {
          "codex:sol": { reasoningEffort: "ultra", serviceTier: "removed" },
        },
      }}
    />,
  );
  expect(
    await screen.findByRole("button", {
      name: "Model: Sol, Low. Change model",
    }),
  ).toBeInTheDocument();
  await user.keyboard("{ArrowRight}");
  await user.click(await screen.findByRole("radio", { name: /^Fast/ }));
  expect(
    screen.getByRole("button", { name: "Model: Sol, Low, Fast. Change model" }),
  ).toBeInTheDocument();
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
