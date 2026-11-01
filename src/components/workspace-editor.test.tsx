import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceEditor } from "./workspace-editor";
import type { Workspace } from "../lib/types";

const api = vi.hoisted(() => ({
  updateWorkspace: vi.fn(),
  workspace: vi.fn(),
}));
vi.mock("../lib/api", () => ({
  api,
  errorText: (error: unknown) => String(error),
}));
const original: Workspace = {
  id: "bot",
  kind: "bots",
  name: "Writer",
  instructions: "Old rules",
};
const onUpdate = vi.fn();
const onClose = vi.fn();
function open() {
  render(
    <WorkspaceEditor
      workspace={original}
      onUpdate={onUpdate}
      onClose={onClose}
    />,
  );
}
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it("cancels without changing saved data", () => {
  open();
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
    target: { value: "Unsaved" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(api.updateWorkspace).not.toHaveBeenCalled();
  expect(onUpdate).not.toHaveBeenCalled();
});

it("sends the opened snapshot and closes only after a successful save", async () => {
  let finish!: (saved: Workspace) => void;
  api.updateWorkspace.mockImplementation(
    () =>
      new Promise<Workspace>((resolve) => {
        finish = resolve;
      }),
  );
  open();
  const name = screen.getByRole("textbox", { name: "Name" });
  fireEvent.change(name, { target: { value: "Revised" } });
  fireEvent.change(screen.getByRole("textbox", { name: /Instructions/ }), {
    target: { value: "New rules" },
  });
  const save = screen.getByRole("button", { name: "Save changes" });
  fireEvent.click(save);
  fireEvent.submit(save.closest("form")!);
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(api.updateWorkspace).toHaveBeenCalledTimes(1);
  expect(api.updateWorkspace).toHaveBeenCalledWith(
    original,
    "Revised",
    "New rules",
  );
  expect(name).toBeDisabled();
  expect(screen.getByRole("button", { name: "Close dialog" })).toBeDisabled();
  expect(onClose).not.toHaveBeenCalled();
  expect(onUpdate).not.toHaveBeenCalled();
  const saved = { ...original, name: "Revised", instructions: "New rules" };
  await act(async () => finish(saved));
  expect(onUpdate).toHaveBeenCalledWith(saved);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("retains edits after failure and replaces them only after an explicit successful reload", async () => {
  api.updateWorkspace.mockRejectedValue(
    "This workspace changed. Load the saved version.",
  );
  api.workspace.mockRejectedValueOnce("Read failed").mockResolvedValueOnce({
    ...original,
    name: "Latest",
    instructions: "Saved elsewhere",
  });
  open();
  const name = screen.getByRole("textbox", { name: "Name" });
  const instructions = screen.getByRole("textbox", { name: /Instructions/ });
  fireEvent.change(name, { target: { value: "My draft" } });
  fireEvent.change(instructions, { target: { value: "My rules" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("alert");
  expect(name).toHaveValue("My draft");
  expect(instructions).toHaveValue("My rules");
  expect(onClose).not.toHaveBeenCalled();
  expect(onUpdate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Load saved version" }));
  await screen.findByText("Read failed");
  expect(name).toHaveValue("My draft");
  expect(instructions).toHaveValue("My rules");
  fireEvent.click(screen.getByRole("button", { name: "Load saved version" }));
  await waitFor(() => expect(name).toHaveValue("Latest"));
  expect(instructions).toHaveValue("Saved elsewhere");
  expect(onClose).not.toHaveBeenCalled();
  expect(api.workspace).toHaveBeenCalledWith(original.id);
  const latest = {
    ...original,
    name: "Latest",
    instructions: "Saved elsewhere",
  };
  expect(onUpdate).toHaveBeenCalledWith(latest);
  api.updateWorkspace.mockResolvedValue(latest);
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(api.updateWorkspace).toHaveBeenLastCalledWith(
      latest,
      "Latest",
      "Saved elsewhere",
    ),
  );
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});

it("uses Unicode scalar name limits and UTF-8 instruction limits without truncating the editor", () => {
  open();
  const name = screen.getByRole("textbox", { name: "Name" });
  const instructions = screen.getByRole("textbox", { name: /Instructions/ });
  fireEvent.change(name, { target: { value: "🦀".repeat(80) } });
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  fireEvent.change(name, { target: { value: "a".repeat(81) } });
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  fireEvent.change(name, { target: { value: "Writer" } });
  const oversized = "界".repeat(2731);
  fireEvent.change(instructions, { target: { value: oversized } });
  expect(instructions).toHaveValue(oversized);
  expect(screen.getByRole("alert")).toHaveTextContent("8 KiB");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(api.updateWorkspace).not.toHaveBeenCalled();
});
