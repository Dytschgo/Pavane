import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { Chat } from "./lib/types";

const mocked = vi.hoisted(() => ({
  listChats: vi.fn(),
  createChat: vi.fn(),
  messages: vi.fn(),
  draft: vi.fn(),
  saveDraft: vi.fn(),
  workspaces: vi.fn(),
  models: vi.fn(),
  rename: vi.fn(),
  keep: vi.fn(),
  delete: vi.fn(),
  stop: vi.fn(),
  createWorkspace: vi.fn(),
  send: vi.fn(),
}));
vi.mock("./lib/api", () => ({
  native: true,
  api: mocked,
  errorText: (error: unknown) => String(error),
}));
const first: Chat = {
  id: "first",
  title: "First conversation",
  createdAt: 1,
  updatedAt: 1,
  expiresAt: null,
  workspaceId: null,
};
const second: Chat = { ...first, id: "second", title: "Second conversation" };

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  mocked.listChats.mockResolvedValue([first, second]);
  mocked.messages.mockResolvedValue({ items: [], hasMore: false });
  mocked.draft.mockResolvedValue("");
  mocked.saveDraft.mockResolvedValue(undefined);
  mocked.workspaces.mockResolvedValue([]);
  mocked.createChat.mockResolvedValue(second);
});
afterEach(cleanup);

describe("durable draft interaction", () => {
  it("acknowledges the latest queued save rather than an earlier write", async () => {
    const releases: (() => void)[] = [];
    mocked.saveDraft.mockImplementation(
      () => new Promise<void>((resolve) => releases.push(resolve)),
    );
    render(<App />);
    const input = await screen.findByRole("textbox", {
      name: "Message",
    });
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.change(input, { target: { value: "latest" } });
    await waitFor(() => expect(releases).toHaveLength(1));
    await act(async () => releases[0]());
    await waitFor(() => expect(releases).toHaveLength(2));
    expect(screen.getByText("Saving draft…")).toBeInTheDocument();
    await act(async () => releases[1]());
    await waitFor(() =>
      expect(screen.queryByText("Saving draft…")).not.toBeInTheDocument(),
    );
    expect(mocked.saveDraft).toHaveBeenLastCalledWith("first", "latest");
  });

  it("keeps a failed unsaved draft when navigating away and back", async () => {
    mocked.saveDraft.mockRejectedValue(new Error("disk full"));
    render(<App />);
    const input = await screen.findByRole("textbox", {
      name: "Message",
    });
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "Do not lose this thought" } });
    await screen.findByText("Draft not saved");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open chat Second conversation",
      }),
    );
    await waitFor(() => expect(input).toHaveValue(""));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open chat First conversation",
      }),
    );
    await waitFor(() => expect(input).toHaveValue("Do not lose this thought"));
    expect(screen.getByText("Draft not saved")).toBeInTheDocument();
  });
});

it("reconciles a reloaded running snapshot to terminal native state", async () => {
  const message = {
    id: "reply",
    chatId: first.id,
    role: "assistant",
    model: "ollama:test",
    content: "partial",
    status: "running",
    createdAt: 1,
    sequence: 1,
  };
  mocked.messages
    .mockResolvedValueOnce({ items: [message], hasMore: false })
    .mockResolvedValue({
      items: [
        { ...message, content: "complete after reload", status: "complete" },
      ],
      hasMore: false,
    });
  render(<App />);
  await screen.findByRole("button", { name: "Stop responses" });
  await screen.findByText("complete after reload", {}, { timeout: 2000 });
  expect(
    screen.queryByRole("button", { name: "Stop responses" }),
  ).not.toBeInTheDocument();
});

it("expires selected content even when title search removes its sidebar row", async () => {
  const deadline = Date.now() + 600;
  mocked.listChats.mockImplementation((offset = 0, search = "") =>
    Promise.resolve(
      search || offset ? [] : [{ ...first, expiresAt: deadline }],
    ),
  );
  mocked.messages.mockResolvedValue({
    items: [
      {
        id: "secret",
        chatId: first.id,
        role: "user",
        model: null,
        content: "Temporary private text",
        status: "complete",
        createdAt: 1,
        sequence: 1,
      },
    ],
    hasMore: false,
  });
  render(<App />);
  await screen.findByText("Temporary private text");
  fireEvent.click(screen.getByRole("button", { name: "Search chats" }));
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search chat titles" }),
    { target: { value: "unmatched" } },
  );
  await screen.findByText("No matching chats");
  await waitFor(
    () =>
      expect(
        screen.queryByText("Temporary private text"),
      ).not.toBeInTheDocument(),
    { timeout: 2000 },
  );
  expect(screen.queryByText("Keep this chat")).not.toBeInTheDocument();
});

it("does not leave loading stuck when opening an already-expired sidebar row", async () => {
  const expired = { ...second, expiresAt: Date.now() - 1 };
  mocked.listChats.mockResolvedValue([first, expired]);
  mocked.messages.mockImplementation((id: string) =>
    id === second.id
      ? Promise.reject("Chat expired")
      : Promise.resolve({ items: [], hasMore: false }),
  );
  render(<App />);
  const input = await screen.findByRole("textbox", { name: "Message" });
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.click(
    screen.getByRole("button", { name: "Open chat Second conversation" }),
  );
  await waitFor(() =>
    expect(screen.queryByText("Opening your chat…")).not.toBeInTheDocument(),
  );
  expect(input).toBeEnabled();
});
