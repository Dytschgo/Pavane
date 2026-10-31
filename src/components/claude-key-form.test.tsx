import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClaudeKeyForm } from "./claude-key-form";

const api = vi.hoisted(() => ({
  saveClaudeConnection: vi.fn(),
  removeClaudeConnection: vi.fn(),
  openExternal: vi.fn(),
}));
vi.mock("../lib/api", () => ({ api }));
const changed = vi.fn();
const KEY = "synthetic-claude-test-key";
const WORKSPACE = "wrkspc_syntheticTest";
beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(cleanup);

it("saves key and workspace atomically once, keeps both read-only while pending and clears them on success", async () => {
  let finish!: () => void;
  api.saveClaudeConnection.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  render(<ClaudeKeyForm onChanged={changed} />);
  const key = screen.getByLabelText("Claude API key");
  const workspace = screen.getByLabelText("Workspace ID (optional)");
  expect(key).toHaveAttribute("type", "password");
  expect(key).toHaveAttribute("autocomplete", "off");
  expect(
    screen.getByRole("button", { name: "Save connection" }),
  ).toBeDisabled();
  fireEvent.change(key, { target: { value: KEY } });
  fireEvent.change(workspace, { target: { value: WORKSPACE } });
  const form = key.closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(api.saveClaudeConnection).toHaveBeenCalledTimes(1);
  expect(api.saveClaudeConnection).toHaveBeenCalledWith(KEY, WORKSPACE);
  expect(key).toHaveAttribute("readonly");
  expect(workspace).toHaveAttribute("readonly");
  expect(form).toHaveAttribute("aria-busy", "true");
  await act(async () => finish());
  await screen.findByText("Claude connection saved.");
  expect(key).toHaveValue("");
  expect(workspace).toHaveValue("");
  expect(changed).toHaveBeenCalledTimes(1);
});

it("omits a workspace only when its field is empty", async () => {
  api.saveClaudeConnection.mockResolvedValue(undefined);
  render(<ClaudeKeyForm onChanged={changed} />);
  fireEvent.change(screen.getByLabelText("Claude API key"), {
    target: { value: KEY },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
  await screen.findByText("Claude connection saved.");
  expect(api.saveClaudeConnection).toHaveBeenCalledWith(KEY, null);
});

it.each([
  "invalid",
  "wrkspc_",
  "wrkspc_has space",
  "wrkspc_é",
  "wrkspc_" + "x".repeat(122),
])(
  "rejects invalid workspace input without native storage access: %j",
  (value) => {
    render(<ClaudeKeyForm onChanged={changed} />);
    const key = screen.getByLabelText("Claude API key");
    const workspace = screen.getByLabelText("Workspace ID (optional)");
    fireEvent.change(key, { target: { value: KEY } });
    fireEvent.change(workspace, { target: { value } });
    expect(workspace).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByRole("button", { name: "Save connection" }),
    ).toBeDisabled();
    fireEvent.submit(key.closest("form")!);
    expect(api.saveClaudeConnection).not.toHaveBeenCalled();
  },
);

it("rejects an invalid key and retains masked inputs on failure without echoing its exception", async () => {
  api.saveClaudeConnection.mockRejectedValue(
    new Error(`synthetic failure ${KEY}`),
  );
  render(<ClaudeKeyForm onChanged={changed} />);
  const key = screen.getByLabelText("Claude API key");
  const workspace = screen.getByLabelText("Workspace ID (optional)");
  fireEvent.change(key, { target: { value: "invalid key" } });
  expect(key).toHaveAttribute("aria-invalid", "true");
  expect(
    screen.getByRole("button", { name: "Save connection" }),
  ).toBeDisabled();
  fireEvent.submit(key.closest("form")!);
  expect(api.saveClaudeConnection).not.toHaveBeenCalled();
  fireEvent.change(key, { target: { value: KEY } });
  fireEvent.change(workspace, { target: { value: WORKSPACE } });
  fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
  await screen.findByText(/Could not save the Claude connection/);
  expect(key).toHaveValue(KEY);
  expect(workspace).toHaveValue(WORKSPACE);
  expect(screen.queryByText(new RegExp(KEY))).not.toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
});

it("removes the entire connection without a read, reports failure and clears inputs only after success", async () => {
  api.removeClaudeConnection
    .mockRejectedValueOnce(new Error(KEY))
    .mockResolvedValueOnce(undefined);
  render(<ClaudeKeyForm onChanged={changed} />);
  const key = screen.getByLabelText("Claude API key");
  const workspace = screen.getByLabelText("Workspace ID (optional)");
  fireEvent.change(key, { target: { value: KEY } });
  fireEvent.change(workspace, { target: { value: WORKSPACE } });
  fireEvent.click(screen.getByRole("button", { name: "Remove connection" }));
  await screen.findByText(/Could not remove the Claude connection/);
  expect(key).toHaveValue(KEY);
  expect(workspace).toHaveValue(WORKSPACE);
  expect(changed).not.toHaveBeenCalled();
  expect(screen.queryByText(new RegExp(KEY))).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove connection" }));
  await screen.findByText("Claude connection removed.");
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(key).toHaveValue("");
  expect(workspace).toHaveValue("");
  expect(api.removeClaudeConnection).toHaveBeenNthCalledWith(1);
  expect(api.removeClaudeConnection).toHaveBeenNthCalledWith(2);
  expect(api.saveClaudeConnection).not.toHaveBeenCalled();
});

it("opens only the static Console URL without submitting either field", async () => {
  api.openExternal.mockResolvedValue(undefined);
  render(<ClaudeKeyForm onChanged={changed} />);
  fireEvent.change(screen.getByLabelText("Claude API key"), {
    target: { value: KEY },
  });
  fireEvent.change(screen.getByLabelText("Workspace ID (optional)"), {
    target: { value: WORKSPACE },
  });
  fireEvent.click(screen.getByRole("button", { name: "Get Claude API key" }));
  expect(api.openExternal).toHaveBeenCalledWith(
    "https://platform.claude.com/settings/keys",
  );
  expect(api.saveClaudeConnection).not.toHaveBeenCalled();
});
