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
import type { Chat, RunEvent, TurnStarted } from "./lib/types";

const mocked = vi.hoisted(() => ({
  listChats: vi.fn(),
  createChat: vi.fn(),
  messages: vi.fn(),
  draft: vi.fn(),
  saveDraft: vi.fn(),
  workspaces: vi.fn(),
  models: vi.fn(),
  catalog: vi.fn(),
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
const sentTurn: TurnStarted = {
  user: {
    id: "sent-user",
    chatId: first.id,
    role: "user",
    content: "Hello",
    model: null,
    status: "complete",
    createdAt: 1,
    sequence: 1,
  },
  runs: [
    {
      id: "sent-run",
      chatId: first.id,
      messageId: "sent-reply",
      model: "codex:sol",
    },
  ],
};
function connectSol() {
  const catalog = {
    models: [
      {
        id: "codex:sol",
        name: "Sol",
        provider: "Codex",
        isDefault: true,
        reasoningEfforts: ["low", "high"],
        defaultReasoningEffort: "low",
        serviceTiers: [],
      },
    ],
    providers: [],
  };
  mocked.catalog.mockResolvedValue(catalog);
  return catalog;
}

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
  mocked.catalog.mockResolvedValue({ models: [], providers: [] });
});
afterEach(cleanup);

it("waits for startup discovery without losing the draft, then sends the default Codex model with explicit settings", async () => {
  const catalog = {
    models: [
      {
        id: "codex:sol",
        name: "Sol",
        provider: "Codex",
        isDefault: true,
        reasoningEfforts: ["low", "high"],
        defaultReasoningEffort: "low",
        serviceTiers: [],
      },
    ],
    providers: [
      {
        id: "codex",
        name: "Codex",
        state: "connected",
        detail: "Connected",
        limits: [],
      },
    ],
  };
  let finishDiscovery: (value: typeof catalog) => void = () => {};
  mocked.catalog.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishDiscovery = resolve;
      }),
  );
  mocked.send.mockResolvedValue({
    user: {
      id: "user",
      chatId: "first",
      role: "user",
      content: "Hello",
      model: null,
      status: "complete",
      createdAt: 1,
      sequence: 1,
    },
    runs: [],
  });
  render(<App />);
  const input = await screen.findByRole("textbox", { name: "Message" });
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: "Hello" } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  expect(mocked.send).not.toHaveBeenCalled();
  expect(input).toHaveValue("Hello");
  expect(
    screen.getByRole("button", { name: "Connecting models" }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("combobox", { name: "Search models" }),
  ).not.toBeInTheDocument();
  await act(async () => finishDiscovery(catalog));
  await screen.findByRole("button", { name: "Model: Sol, Low. Change model" });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await waitFor(() =>
    expect(mocked.send).toHaveBeenCalledWith(
      "first",
      "Hello",
      ["codex:sol"],
      expect.any(Function),
      { "codex:sol": { reasoningEffort: "low", serviceTier: "default" } },
    ),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("reuses a pristine current chat instead of accumulating empty conversations", async () => {
  render(<App />);
  const input = await screen.findByRole("textbox", { name: "Message" });
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  expect(mocked.createChat).not.toHaveBeenCalled();
  expect(input).toHaveFocus();
});

it("does not steal search focus when a pending send finishes", async () => {
  connectSol();
  let finishSend: (turn: TurnStarted) => void = () => {
    throw new Error("Send was not started");
  };
  mocked.send.mockImplementation(
    () =>
      new Promise<TurnStarted>((resolve) => {
        finishSend = resolve;
      }),
  );
  render(<App />);
  await screen.findByRole("button", { name: "Model: Sol, Low. Change model" });
  const input = screen.getByRole("textbox", { name: "Message" });
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: "Hello" } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(mocked.send).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Search chats" }));
  const search = await screen.findByRole("textbox", {
    name: "Search chat titles",
  });
  search.focus();
  await act(async () => finishSend({ ...sentTurn, runs: [] }));
  await waitFor(() => expect(input).toBeEnabled());
  await act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  expect(search).toHaveFocus();
});

it("keeps the next message sendable while post-response quota discovery is pending", async () => {
  const catalog = connectSol();
  let finishRefresh: (value: typeof catalog) => void = () => {
    throw new Error("Refresh was not started");
  };
  mocked.catalog.mockResolvedValueOnce(catalog).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRefresh = resolve;
      }),
  );
  let receive: (event: RunEvent) => void = () => {
    throw new Error("Run callback was not registered");
  };
  mocked.send
    .mockImplementationOnce(
      (
        _id: string,
        _text: string,
        _models: string[],
        onEvent: (event: RunEvent) => void,
      ) => {
        receive = onEvent;
        return Promise.resolve(sentTurn);
      },
    )
    .mockResolvedValue({
      user: { ...sentTurn.user, id: "follow-up", sequence: 3 },
      runs: [],
    });
  render(<App />);
  await screen.findByRole("button", { name: "Model: Sol, Low. Change model" });
  const input = screen.getByRole("textbox", { name: "Message" });
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: "Hello" } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await screen.findByRole("button", { name: "Stop responses" });
  fireEvent.change(input, { target: { value: "Follow-up" } });
  await act(async () =>
    receive({
      runId: "sent-run",
      chatId: first.id,
      messageId: "sent-reply",
      kind: "finished",
      delta: "Done",
      status: "complete",
      error: null,
    }),
  );
  await waitFor(() => expect(mocked.catalog).toHaveBeenCalledTimes(2));
  try {
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
    expect(input).toHaveValue("Follow-up");
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(mocked.send).toHaveBeenCalledTimes(2));
  } finally {
    await act(async () => finishRefresh(catalog));
  }
});

it("identifies the originating chat when its response fails after navigation", async () => {
  connectSol();
  let receive: (event: RunEvent) => void = () => {
    throw new Error("Run callback was not registered");
  };
  mocked.send.mockImplementation(
    (
      _id: string,
      _text: string,
      _models: string[],
      onEvent: (event: RunEvent) => void,
    ) => {
      receive = onEvent;
      return Promise.resolve(sentTurn);
    },
  );
  render(<App />);
  await screen.findByRole("button", { name: "Model: Sol, Low. Change model" });
  const input = screen.getByRole("textbox", { name: "Message" });
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: "Hello" } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await screen.findByRole("button", { name: "Stop responses" });
  fireEvent.click(
    screen.getByRole("button", { name: "Open chat Second conversation" }),
  );
  await waitFor(() =>
    expect(mocked.messages).toHaveBeenLastCalledWith(second.id),
  );
  await act(async () =>
    receive({
      runId: "sent-run",
      chatId: first.id,
      messageId: "sent-reply",
      kind: "finished",
      delta: "",
      status: "failed",
      error: "Synthetic disconnect",
    }),
  );
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("First conversation");
  expect(alert).toHaveTextContent("Sol");
  expect(alert).toHaveTextContent("Synthetic disconnect");
  expect(alert).not.toHaveTextContent("Second conversation");
});

describe("durable draft interaction", () => {
  it("coalesces a burst behind a slow save into the latest durable snapshot", async () => {
    let release: () => void = () => {
      throw new Error("Save was not started");
    };
    mocked.saveDraft.mockResolvedValue(undefined).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(<App />);
    const input = await screen.findByRole("textbox", { name: "Message" });
    await waitFor(() => expect(input).toBeEnabled());
    const initial = "a".repeat(16 * 1024);
    fireEvent.change(input, { target: { value: initial } });
    await waitFor(() => expect(mocked.saveDraft).toHaveBeenCalledTimes(1));
    for (let edit = 1; edit <= 200; edit++)
      fireEvent.change(input, { target: { value: initial + edit } });
    await act(async () => release());
    await waitFor(() =>
      expect(mocked.saveDraft).toHaveBeenLastCalledWith(
        first.id,
        initial + 200,
      ),
    );
    expect(mocked.saveDraft).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Saving draft…")).not.toBeInTheDocument();
    expect(screen.queryByText("Draft not saved")).not.toBeInTheDocument();
  });

  it("preserves oversized Unicode text with explicit feedback until it can be saved", async () => {
    connectSol();
    render(<App />);
    await screen.findByRole("button", {
      name: "Model: Sol, Low. Change model",
    });
    const input = screen.getByRole("textbox", { name: "Message" });
    await waitFor(() => expect(input).toBeEnabled());
    const oversized = "界".repeat(30_000);
    fireEvent.change(input, { target: { value: oversized } });
    await screen.findByText(/Shorten it to save and send/);
    expect(input).toHaveValue(oversized);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(mocked.saveDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(mocked.send).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Open chat Second conversation" }),
    );
    await waitFor(() => expect(input).toHaveValue(""));
    fireEvent.click(
      screen.getByRole("button", { name: "Open chat First conversation" }),
    );
    await waitFor(() => expect(input).toHaveValue(oversized));
    fireEvent.change(input, { target: { value: "界".repeat(20_000) } });
    await waitFor(() => expect(mocked.saveDraft).toHaveBeenCalledTimes(1));
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
    expect(
      screen.queryByText(/Shorten it to save and send/),
    ).not.toBeInTheDocument();
  });

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
  let rejectRead: (reason: string) => void = () => {
    throw new Error("Expired read was not started");
  };
  const delayedRead = new Promise<never>((_resolve, reject) => {
    rejectRead = reject;
  });
  mocked.listChats.mockResolvedValue([first, expired]);
  mocked.messages.mockImplementation((id: string) =>
    id === second.id
      ? delayedRead
      : Promise.resolve({ items: [], hasMore: false }),
  );
  render(<App />);
  const input = await screen.findByRole("textbox", { name: "Message" });
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.click(
    screen.getByRole("button", { name: "Open chat Second conversation" }),
  );
  expect(screen.getByText("Opening your chat…")).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByText("Opening your chat…")).not.toBeInTheDocument(),
  );
  expect(input).toBeDisabled();
  expect(screen.getByRole("button", { name: "New chat" })).toBeEnabled();
  await act(async () => {
    rejectRead("Chat expired");
  });
});
