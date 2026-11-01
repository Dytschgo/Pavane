import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Providers } from "./providers";

afterEach(cleanup);

it("shows one setup form without folding the provider list or losing an edit", () => {
  render(
    <Providers
      models={[]}
      providers={[]}
      busy={false}
      onRefresh={vi.fn()}
      error={null}
    />,
  );
  expect(screen.getAllByRole("button", { name: /^Manage / })).toHaveLength(5);
  fireEvent.click(screen.getByRole("button", { name: "Manage Gemini API" }));
  expect(
    screen.getByRole("region", { name: "Gemini API setup" }),
  ).toBeVisible();
  expect(screen.queryByRole("region", { name: "Claude API setup" })).toBeNull();
  const key = screen.getByLabelText("Gemini API key");
  fireEvent.change(key, { target: { value: "synthetic-unsaved" } });
  fireEvent.click(screen.getByRole("button", { name: "Manage Claude API" }));
  expect(key).not.toBeVisible();
  expect(
    screen.getByRole("region", { name: "Claude API setup" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Manage Gemini API" }));
  expect(key).toHaveValue("synthetic-unsaved");
  expect(key).toBeVisible();
});

it("keeps one recheck action available after failure and disables it during discovery", () => {
  const onRefresh = vi.fn();
  const view = (busy: boolean, error: string | null) => (
    <Providers
      models={[]}
      providers={[]}
      busy={busy}
      onRefresh={onRefresh}
      error={error}
    />
  );
  const { rerender } = render(view(false, "Could not check connections"));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Could not check connections",
  );
  fireEvent.click(screen.getByRole("button", { name: "Recheck connections" }));
  expect(onRefresh).toHaveBeenCalledTimes(1);
  rerender(view(true, null));
  expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
  expect(screen.queryByRole("alert")).toBeNull();
  rerender(view(false, null));
  expect(
    screen.getByRole("button", { name: "Recheck connections" }),
  ).toBeEnabled();
});

it("distinguishes unavailable services, missing keys and required sign-in", () => {
  render(
    <Providers
      models={[]}
      providers={[
        {
          id: "ollama",
          name: "Ollama",
          state: "unavailable",
          detail: "Start Ollama",
          limits: [],
        },
        {
          id: "gemini",
          name: "Gemini",
          state: "needsKey",
          detail: "Add a key",
          limits: [],
        },
        {
          id: "codex",
          name: "Codex",
          state: "signedOut",
          detail: "Sign in",
          limits: [],
        },
      ]}
      busy={false}
      onRefresh={vi.fn()}
      error={null}
    />,
  );
  expect(
    within(screen.getByRole("button", { name: "Manage Ollama" })).getByText(
      "Needs attention",
    ),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("button", { name: "Manage Gemini API" })).getByText(
      "Add API key",
    ),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("button", { name: "Manage Codex" })).getByText(
      "Sign in needed",
    ),
  ).toBeInTheDocument();
});

it("explains a connected Ollama with no models without asking for another connection", () => {
  const { rerender } = render(
    <Providers
      initialProvider="ollama"
      models={[]}
      providers={[
        {
          id: "ollama",
          name: "Ollama",
          state: "connected",
          detail: "0 local models",
          limits: [],
        },
      ]}
      busy={false}
      onRefresh={vi.fn()}
      error={null}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Add a text model in Ollama, then recheck connections.",
  );
  expect(screen.queryByText("0 local models")).toBeNull();
  rerender(
    <Providers
      initialProvider="ollama"
      models={[{ id: "ollama:local", name: "Local", provider: "Ollama" }]}
      providers={[
        {
          id: "ollama",
          name: "Ollama",
          state: "connected",
          detail: "1 local model",
          limits: [],
        },
      ]}
      busy={false}
      onRefresh={vi.fn()}
      error={null}
    />,
  );
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByText("1 local model")).toBeInTheDocument();
});
