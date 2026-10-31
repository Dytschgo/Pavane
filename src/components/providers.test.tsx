import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
