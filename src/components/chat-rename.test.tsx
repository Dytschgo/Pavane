import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChatRename } from "./chat-rename";

const rename = vi.hoisted(() => vi.fn());
vi.mock("../lib/api", () => ({
  api: { rename },
  errorText: (error: unknown) => String(error),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("admits one write, freezes dismissal and reports only the committed title", async () => {
  let resolve!: () => void;
  rename.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <ChatRename
      chatId="chat-a"
      title="Original"
      onSaved={onSaved}
      onClose={onClose}
    />,
  );
  const input = screen.getByRole("textbox", { name: "Title" });
  fireEvent.change(input, { target: { value: "  Grüezi 🦀  " } });
  const form = input.closest("form")!;
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  expect(rename).toHaveBeenCalledTimes(1);
  expect(rename).toHaveBeenCalledWith("chat-a", "Grüezi 🦀");
  expect(input).toBeDisabled();
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Close dialog" })).toBeDisabled();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
  expect(onSaved).not.toHaveBeenCalled();
  await act(async () => {
    resolve();
  });
  await waitFor(() =>
    expect(onSaved).toHaveBeenCalledExactlyOnceWith("Grüezi 🦀"),
  );
});

it("retains a rejected edit and permits an explicit corrected retry", async () => {
  rename
    .mockRejectedValueOnce(new Error("Synthetic storage failure"))
    .mockResolvedValueOnce(undefined);
  const onSaved = vi.fn();
  render(
    <ChatRename
      chatId="chat-b"
      title="Original"
      onSaved={onSaved}
      onClose={vi.fn()}
    />,
  );
  const input = screen.getByRole("textbox", { name: "Title" });
  fireEvent.change(input, { target: { value: "Keep my edit" } });
  fireEvent.click(screen.getByRole("button", { name: "Save title" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Synthetic storage failure",
  );
  expect(input).toHaveValue("Keep my edit");
  expect(input).toBeEnabled();
  expect(onSaved).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "Corrected title" } });
  fireEvent.click(screen.getByRole("button", { name: "Save title" }));
  await waitFor(() =>
    expect(onSaved).toHaveBeenCalledExactlyOnceWith("Corrected title"),
  );
  expect(rename).toHaveBeenNthCalledWith(2, "chat-b", "Corrected title");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("refuses a whitespace-only title and cancels without writing", () => {
  const onClose = vi.fn();
  render(
    <ChatRename
      chatId="chat-c"
      title="Original"
      onSaved={vi.fn()}
      onClose={onClose}
    />,
  );
  const input = screen.getByRole("textbox", { name: "Title" });
  fireEvent.change(input, { target: { value: " \t " } });
  expect(screen.getByRole("button", { name: "Save title" })).toBeDisabled();
  fireEvent.submit(input.closest("form")!);
  expect(rename).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
