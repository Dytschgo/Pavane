import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import userEvent from "@testing-library/user-event";
import type { Catalog, Chat, RunEvent, TurnStarted } from "./lib/types";

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
  stopResponse: vi.fn(),
  createWorkspace: vi.fn(),
  workspace: vi.fn(),
  updateWorkspace: vi.fn(),
  saveGeminiKey: vi.fn(),
  removeGeminiKey: vi.fn(),
  saveXaiKey: vi.fn(),
  removeXaiKey: vi.fn(),
  saveClaudeConnection: vi.fn(),
  removeClaudeConnection: vi.fn(),
  send: vi.fn(),
}));
let resizeContent: ResizeObserverCallback;
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

async function openNavigation() {
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  await screen.findByRole("dialog", { name: "Chats" });
}
async function openConnections() {
  await openNavigation();
  fireEvent.click(screen.getByRole("button", { name: "Connections" }));
  await screen.findByRole("dialog", { name: "Your connections" });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeContent = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  mocked.listChats.mockResolvedValue([first, second]);
  mocked.messages.mockResolvedValue({ items: [], hasMore: false });
  mocked.draft.mockResolvedValue("");
  mocked.saveDraft.mockResolvedValue(undefined);
  mocked.stopResponse.mockResolvedValue(undefined);
  mocked.workspaces.mockResolvedValue([]);
  mocked.createChat.mockResolvedValue(second);
  mocked.catalog.mockResolvedValue({ models: [], providers: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("stops one restored response by chat/message identity without stopping its sibling or changing the draft", async () => {
  connectSol();
  const replies = ["one", "two"].map((id, index) => ({
    ...sentTurn.user,
    id,
    role: "assistant" as const,
    model: "codex:sol",
    status: "running" as const,
    content: `Partial ${id}`,
    sequence: index + 2,
  }));
  mocked.messages.mockResolvedValue({
    items: [sentTurn.user, ...replies],
    hasMore: false,
  });
  mocked.draft.mockResolvedValue("My unsent draft");
  render(<App />);
  await screen.findByRole("button", { name: "Model: Sol, Low. Change model" });
  const articles = await screen.findAllByRole("article", {
    name: "Response from Sol",
  });
  const editor = screen.getByRole("textbox", { name: "Message" });
  await waitFor(() => expect(editor).toHaveValue("My unsent draft"));
  fireEvent.click(
    within(articles[0]).getByRole("button", { name: "Stop this response" }),
  );
  await waitFor(() =>
    expect(mocked.stopResponse).toHaveBeenCalledWith(first.id, "one"),
  );
  expect(mocked.stop).not.toHaveBeenCalled();
  expect(
    within(articles[1]).getByRole("button", { name: "Stop this response" }),
  ).toBeEnabled();
  expect(within(articles[1]).getByText("Partial two")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Stop responses" }),
  ).toBeInTheDocument();
  expect(editor).toHaveValue("My unsent draft");
  expect(mocked.send).not.toHaveBeenCalled();
});

it.each(["", "My unsent note 🦀\nKeep this exactly."])(
  "adds an earlier prompt to the draft without sending or changing history (%s)",
  async (existing) => {
    connectSol();
    mocked.messages.mockResolvedValue({
      items: [sentTurn.user],
      hasMore: false,
    });
    mocked.draft.mockResolvedValue(existing);
    render(<App />);
    const action = await screen.findByRole("button", {
      name: "Add prompt to draft",
    });
    await screen.findByRole("button", {
      name: "Model: Sol, Low. Change model",
    });
    const editor = screen.getByRole("textbox", {
      name: "Message",
    });
    await waitFor(() => expect(editor).toHaveValue(existing));
    fireEvent.click(action);
    const expected = existing ? `${existing}\n\nHello` : "Hello";
    expect(editor).toHaveValue(expected);
    expect(editor).toHaveFocus();
    await waitFor(() =>
      expect(mocked.saveDraft).toHaveBeenLastCalledWith(first.id, expected),
    );
    expect(mocked.send).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Your message")).toHaveTextContent("Hello");
    expect(
      screen.getByRole("button", { name: "Model: Sol, Low. Change model" }),
    ).toBeInTheDocument();
  },
);

it("preserves a valid multibyte draft when reusing a prompt would exceed its byte limit", async () => {
  const existing = "界".repeat(21844); // 65,532 bytes; under the existing limit.
  mocked.messages.mockResolvedValue({ items: [sentTurn.user], hasMore: false });
  mocked.draft.mockResolvedValue(existing);
  render(<App />);
  const action = await screen.findByRole("button", {
    name: "Add prompt to draft",
  });
  const editor = screen.getByRole("textbox", { name: "Message" });
  await waitFor(() => expect(editor).toHaveValue(existing));
  fireEvent.click(action);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Shorten your draft first.",
  );
  expect(editor).toHaveValue(existing);
  expect(mocked.saveDraft).not.toHaveBeenCalled();
  expect(mocked.send).not.toHaveBeenCalled();
  fireEvent.change(editor, { target: { value: "Room now" } });
  fireEvent.click(action);
  expect(editor).toHaveValue("Room now\n\nHello");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("follows deferred content growth without undoing upward reading", async () => {
  mocked.messages.mockResolvedValue({ items: [sentTurn.user], hasMore: false });
  render(<App />);
  await screen.findByText("Hello");
  const area = screen.getByLabelText("Conversation");
  let height = 1500;
  let top = 0;
  Object.defineProperties(area, {
    scrollHeight: { get: () => height },
    clientHeight: { value: 500 },
    scrollTop: {
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(value, height - 500));
      },
    },
  });
  act(() => resizeContent([], {} as ResizeObserver));
  expect(area.scrollTop).toBe(1000);
  fireEvent.scroll(area);
  height = 2200;
  fireEvent.scroll(area); // Content grew; the reader did not scroll upward.
  act(() => resizeContent([], {} as ResizeObserver));
  expect(area.scrollTop).toBe(1700);
  fireEvent.scroll(area);
  area.scrollTop = 900;
  fireEvent.scroll(area);
  height = 3000;
  act(() => resizeContent([], {} as ResizeObserver));
  expect(area.scrollTop).toBe(900);
  fireEvent.wheel(area, { deltaY: 2000, deltaMode: 0 });
  // Native scrolling reaches the old bottom, but Markdown grows before the
  // scroll event is delivered. Current geometry alone would miss the intent.
  height = 3600;
  area.scrollTop = 2500;
  fireEvent.scroll(area);
  act(() => resizeContent([], {} as ResizeObserver));
  expect(area.scrollTop).toBe(3100);
});

it("follows a new send from an unpinned conversation before any reply delta", async () => {
  connectSol();
  mocked.messages.mockResolvedValue({ items: [sentTurn.user], hasMore: false });
  mocked.send.mockResolvedValue({
    ...sentTurn,
    user: { ...sentTurn.user, id: "next-user", content: "Next", sequence: 2 },
  });
  render(<App />);
  await screen.findByText("Hello");
  await screen.findByRole("button", { name: "Model: Sol, Low. Change model" });
  const input = screen.getByRole("textbox", { name: "Message" });
  await waitFor(() => expect(input).toBeEnabled());
  const area = screen.getByLabelText("Conversation");
  let height = 1500;
  let top = 0;
  Object.defineProperties(area, {
    scrollHeight: { get: () => height },
    clientHeight: { value: 500 },
    scrollTop: {
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(value, height - 500));
      },
    },
  });
  act(() => resizeContent([], {} as ResizeObserver));
  area.scrollTop = 400;
  fireEvent.scroll(area);
  fireEvent.change(input, { target: { value: "Next" } });
  height = 2200; // Geometry after the submitted turn is inserted.
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await screen.findByRole("button", { name: "Stop responses" });
  // No response callback or size notification has been supplied: the changed
  // message count must still perform the observer setup's initial follow.
  expect(area.scrollTop).toBe(1700);
});

it.each(["zoom", "horizontal", "nested"])(
  "does not resume following for a %s gesture",
  async (kind) => {
    mocked.messages.mockResolvedValue({
      items: [sentTurn.user],
      hasMore: false,
    });
    render(<App />);
    const message = await screen.findByText("Hello");
    const area = screen.getByLabelText("Conversation");
    Object.defineProperties(area, {
      scrollHeight: { value: 3000 },
      clientHeight: { value: 500 },
    });
    act(() => resizeContent([], {} as ResizeObserver));
    area.scrollTop = 1000;
    fireEvent.scroll(area);
    if (kind === "nested") {
      message.style.overflowY = "auto";
      Object.defineProperties(message, {
        clientHeight: { value: 100 },
        scrollHeight: { value: 400 },
      });
    }
    fireEvent.wheel(message, {
      deltaY: 10000,
      deltaMode: 0,
      ctrlKey: kind === "zoom",
      shiftKey: kind === "horizontal",
    });
    act(() => resizeContent([], {} as ResizeObserver));
    expect(area.scrollTop).toBe(1000);
  },
);

it("keeps the visible message in place when an earlier page is prepended", async () => {
  const visible = {
    ...sentTurn.user,
    id: "visible",
    sequence: 3,
    content: "Visible anchor",
  };
  const older = {
    ...visible,
    id: "older",
    sequence: 1,
    content: "Older message",
  };
  mocked.messages.mockImplementation((_chatId: string, before?: number) =>
    Promise.resolve(
      before
        ? { items: [older], hasMore: false }
        : { items: [visible], hasMore: true },
    ),
  );
  render(<App />);
  const original = await screen.findByText("Visible anchor");
  const area = screen.getByLabelText("Conversation");
  area.scrollTop = 10;
  const geometry = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      if (this === area) return new DOMRect(0, 0, 800, 600);
      if (this.classList.contains("message"))
        return new DOMRect(
          0,
          screen.queryByText("Older message") ? 200 : 100,
          800,
          80,
        );
      return new DOMRect();
    });
  try {
    fireEvent.click(
      screen.getByRole("button", { name: "Load earlier messages" }),
    );
    await screen.findByText("Older message");
    expect(screen.getByText("Visible anchor")).toBe(original);
    expect(area.scrollTop).toBe(110);
  } finally {
    geometry.mockRestore();
  }
});

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

it("edits the active workspace without creating a chat or changing the current message", async () => {
  const workspace = {
    id: "bot",
    kind: "bots",
    name: "Writer",
    instructions: "Old rules",
  };
  const saved = { ...workspace, name: "Revised", instructions: "New rules" };
  mocked.listChats.mockResolvedValue([{ ...first, workspaceId: workspace.id }]);
  mocked.workspaces.mockResolvedValue([workspace]);
  mocked.messages.mockResolvedValue({ items: [sentTurn.user], hasMore: false });
  mocked.updateWorkspace.mockResolvedValue(saved);
  render(<App />);
  await screen.findByText("Hello");
  fireEvent.click(
    screen.getByRole("button", { name: "Edit name and instructions" }),
  );
  const name = screen.getByRole("textbox", { name: "Name" });
  expect(name).toHaveValue("Writer");
  fireEvent.change(name, { target: { value: "Revised" } });
  fireEvent.change(screen.getByRole("textbox", { name: /Instructions/ }), {
    target: { value: "New rules" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(mocked.updateWorkspace).toHaveBeenCalledWith(
    workspace,
    "Revised",
    "New rules",
  );
  expect(screen.getByText("Hello")).toBeInTheDocument();
  expect(mocked.createChat).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Edit name and instructions" }),
  );
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Revised");
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
  await openNavigation();

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
  await openNavigation();

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
    await screen.findByText(/Shorten it first/);
    expect(input).toHaveValue(oversized);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(mocked.saveDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(mocked.send).not.toHaveBeenCalled();
    await openNavigation();

    fireEvent.click(
      screen.getByRole("button", { name: "Open chat Second conversation" }),
    );
    await waitFor(() => expect(input).toHaveValue(""));
    await openNavigation();

    fireEvent.click(
      screen.getByRole("button", { name: "Open chat First conversation" }),
    );
    await waitFor(() => expect(input).toHaveValue(oversized));
    fireEvent.change(input, { target: { value: "界".repeat(20_000) } });
    await waitFor(() => expect(mocked.saveDraft).toHaveBeenCalledTimes(1));
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
    expect(screen.queryByText(/Shorten it first/)).not.toBeInTheDocument();
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
    await openNavigation();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open chat Second conversation",
      }),
    );
    await waitFor(() => expect(input).toHaveValue(""));
    await openNavigation();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open chat First conversation",
      }),
    );
    await waitFor(() => expect(input).toHaveValue("Do not lose this thought"));
    expect(screen.getByText("Draft not saved")).toBeInTheDocument();
  });
});

it("IME Escape leaves responses and the draft intact; normal Escape stops the chat", async () => {
  mocked.messages.mockResolvedValue({
    items: [
      {
        ...sentTurn.user,
        id: "streaming-reply",
        role: "assistant",
        model: "codex:sol",
        content: "Partial response",
        status: "running",
      },
    ],
    hasMore: false,
  });
  mocked.draft.mockResolvedValue("未確定の入力");
  mocked.stop.mockResolvedValue(undefined);
  render(<App />);
  await screen.findByRole("button", { name: "Stop responses" });
  const editor = screen.getByRole("textbox", { name: "Message" });
  await waitFor(() => {
    expect(editor).toBeEnabled();
    expect(editor).toHaveValue("未確定の入力");
  });
  expect(fireEvent.keyDown(editor, { key: "Escape", isComposing: true })).toBe(
    true,
  );
  expect(mocked.stop).not.toHaveBeenCalled();
  expect(editor).toHaveValue("未確定の入力");
  expect(fireEvent.keyDown(editor, { key: "Escape", isComposing: false })).toBe(
    false,
  );
  expect(mocked.stop).toHaveBeenCalledTimes(1);
  expect(mocked.stop).toHaveBeenCalledWith(first.id);
  expect(editor).toHaveValue("未確定の入力");
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
  await openNavigation();

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
  await openNavigation();

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

it("removing a Gemini key preserves its selection without falling back to another provider", async () => {
  const codex = connectSol();
  mocked.catalog.mockResolvedValue({
    models: [
      ...codex.models,
      { id: "gemini:gemini-test", name: "Gemini test", provider: "Gemini" },
    ],
    providers: [],
  });
  mocked.removeGeminiKey.mockResolvedValue(undefined);
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Model: Sol, Low. Change model",
    }),
  );
  fireEvent.click(await screen.findByRole("option", { name: /Gemini test/ }));
  await screen.findByRole("button", {
    name: "Model: Gemini test. Change model",
  });
  await openConnections();
  fireEvent.click(screen.getByRole("button", { name: "Manage Gemini API" }));
  await screen.findByLabelText("Gemini API key");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Recheck connections" }),
    ).toBeEnabled(),
  );
  mocked.catalog.mockResolvedValue(codex);
  fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
  await screen.findByText("API key removed.");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Recheck connections" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Model: gemini-test (unavailable). Change model",
    }),
  );
  expect(
    await screen.findByRole("option", { name: /Sol/ }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: /Gemini test/ }),
  ).not.toBeInTheDocument();
  expect(mocked.removeGeminiKey).toHaveBeenCalledTimes(1);
});

it("invalidates only Claude while discovery is pending and preserves its unavailable selection", async () => {
  const codex = connectSol();
  const remaining: Catalog = {
    models: [
      ...codex.models,
      { id: "gemini:gemini-test", name: "Gemini test", provider: "Gemini" },
    ],
    providers: [],
  };
  mocked.catalog.mockResolvedValue({
    ...remaining,
    models: [
      ...remaining.models,
      { id: "claude:opaque-model-id", name: "Claude test", provider: "Claude" },
    ],
  });
  mocked.removeClaudeConnection.mockResolvedValue(undefined);
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Model: Sol, Low. Change model",
    }),
  );
  fireEvent.click(await screen.findByRole("option", { name: /Claude test/ }));
  await screen.findByRole("button", {
    name: "Model: Claude test. Change model",
  });
  await openConnections();
  fireEvent.click(screen.getByRole("button", { name: "Manage Claude API" }));
  await screen.findByLabelText("Claude API key");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Recheck connections" }),
    ).toBeEnabled(),
  );
  let finish!: (catalog: Catalog) => void;
  mocked.catalog.mockReturnValue(
    new Promise<Catalog>((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove connection" }));
  await screen.findByText("Claude connection removed.");
  expect(screen.getByText("2 models ready")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Model: Connecting models. Change model",
    }),
  );
  expect(
    await screen.findByRole("option", { name: /Gemini test/ }),
  ).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /Sol/ })).toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: /Claude test/ }),
  ).not.toBeInTheDocument();
  await act(async () => finish(remaining));
  expect(
    await screen.findByRole("button", {
      name: "Model: opaque-model-id (unavailable). Change model",
    }),
  ).toBeInTheDocument();
  expect(mocked.removeClaudeConnection).toHaveBeenCalledTimes(1);
  expect(mocked.removeGeminiKey).not.toHaveBeenCalled();
});

it("invalidates only xAI while discovery is pending and preserves its unavailable selection", async () => {
  const codex = connectSol();
  const remaining: Catalog = {
    models: [
      ...codex.models,
      { id: "gemini:gemini-test", name: "Gemini test", provider: "Gemini" },
      { id: "claude:opaque-model-id", name: "Claude test", provider: "Claude" },
    ],
    providers: [
      {
        id: "gemini",
        name: "Gemini API",
        state: "connected",
        detail: "Gemini access retained",
        limits: [],
      },
      {
        id: "claude",
        name: "Claude API",
        state: "connected",
        detail: "Claude access retained",
        limits: [],
      },
    ],
  };
  mocked.catalog.mockResolvedValue({
    ...remaining,
    providers: [
      ...remaining.providers,
      {
        id: "xai",
        name: "xAI API",
        state: "connected",
        detail: "xAI synthetic access",
        limits: [],
      },
    ],
    models: [
      ...remaining.models,
      { id: "xai:opaque-model-id", name: "xAI test", provider: "xAI" },
    ],
  });
  mocked.removeXaiKey.mockResolvedValue(undefined);
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Model: Sol, Low. Change model",
    }),
  );
  fireEvent.click(await screen.findByRole("option", { name: /xAI test/ }));
  await screen.findByRole("button", {
    name: "Model: xAI test. Change model",
  });
  await openConnections();
  fireEvent.click(screen.getByRole("button", { name: "Manage xAI API" }));
  await screen.findByLabelText("xAI API key");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Recheck connections" }),
    ).toBeEnabled(),
  );
  let finish!: (catalog: Catalog) => void;
  mocked.catalog.mockReturnValue(
    new Promise<Catalog>((resolve) => {
      finish = resolve;
    }),
  );
  for (const provider of ["Gemini", "Claude", "xAI"]) {
    expect(
      within(
        screen.getByRole("button", { name: `Manage ${provider} API` }),
      ).getByText("Connected"),
    ).toBeInTheDocument();
  }
  fireEvent.click(screen.getByRole("button", { name: "Remove xAI key" }));
  await screen.findByText("xAI API key removed.");
  expect(screen.getByText("3 models ready")).toBeInTheDocument();
  for (const provider of ["Gemini", "Claude"]) {
    expect(
      within(
        screen.getByRole("button", { name: `Manage ${provider} API` }),
      ).getByText("Connected"),
    ).toBeInTheDocument();
  }
  expect(
    within(screen.getByRole("button", { name: "Manage xAI API" })).getByText(
      "Checking…",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Model: Connecting models. Change model",
    }),
  );
  expect(
    await screen.findByRole("option", { name: /Gemini test/ }),
  ).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /Sol/ })).toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: /xAI test/ }),
  ).not.toBeInTheDocument();
  await act(async () => finish(remaining));
  expect(
    await screen.findByRole("button", {
      name: "Model: opaque-model-id (unavailable). Change model",
    }),
  ).toBeInTheDocument();
  expect(mocked.removeXaiKey).toHaveBeenCalledTimes(1);
  expect(mocked.removeGeminiKey).not.toHaveBeenCalled();
  expect(mocked.removeClaudeConnection).not.toHaveBeenCalled();
  expect(
    screen.getByRole("option", { name: /Claude test/ }),
  ).toBeInTheDocument();
});

it("retries a failed response without resubmitting its user message or clearing the draft", async () => {
  connectSol();
  const failed = {
    ...sentTurn.user,
    id: "failed-reply",
    role: "assistant" as const,
    model: "codex:sol",
    content: "Saved partial",
    status: "failed" as const,
    sequence: 2,
  };
  mocked.messages.mockResolvedValue({
    items: [sentTurn.user, failed],
    hasMore: false,
  });
  mocked.draft.mockResolvedValue("Keep my unsent note 🦀");
  mocked.send.mockResolvedValue({
    ...sentTurn,
    runs: [{ ...sentTurn.runs[0], id: "retry-run", messageId: "retry-reply" }],
  });
  render(<App />);
  await screen.findByRole("button", { name: "Model: Sol, Low. Change model" });
  const editor = screen.getByRole("textbox", { name: "Message" });
  await waitFor(() => expect(editor).toHaveValue("Keep my unsent note 🦀"));
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() =>
    expect(mocked.send).toHaveBeenCalledWith(
      first.id,
      "",
      ["codex:sol"],
      expect.any(Function),
      { "codex:sol": { reasoningEffort: "low", serviceTier: "default" } },
      "failed-reply",
    ),
  );
  expect(editor).toHaveValue("Keep my unsent note 🦀");
  expect(screen.getAllByRole("article", { name: "Your message" })).toHaveLength(
    1,
  );
  expect(screen.getByText("Saved partial")).toBeInTheDocument();
  expect(mocked.saveDraft).not.toHaveBeenCalled();
});

it("rechecks a failed connection without clearing the draft or sending a message", async () => {
  mocked.catalog.mockRejectedValue(new Error("Synthetic discovery failure"));
  mocked.draft.mockResolvedValue("Keep this note");
  render(<App />);
  const editor = await screen.findByRole("textbox", { name: "Message" });
  await waitFor(() => expect(editor).toHaveValue("Keep this note"));
  await openConnections();
  await screen.findByText(/Couldn’t check connections/);
  connectSol();
  fireEvent.click(screen.getByRole("button", { name: "Recheck connections" }));
  await screen.findByText("1 model ready");
  expect(screen.queryByText(/Couldn’t check connections/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Open navigation" }),
    ).toHaveFocus(),
  );
  expect(editor).toHaveValue("Keep this note");
  expect(mocked.send).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "Provider connections" }),
  ).toBeNull();
  await openNavigation();
  expect(screen.getAllByRole("button", { name: "Connections" })).toHaveLength(
    1,
  );
});

it("retries the exact failed draft save and removes the warning only after acknowledgement", async () => {
  mocked.saveDraft
    .mockRejectedValueOnce(new Error("Synthetic disk failure"))
    .mockResolvedValue(undefined);
  render(<App />);
  const editor = await screen.findByRole("textbox", { name: "Message" });
  await waitFor(() => expect(editor).toBeEnabled());
  fireEvent.change(editor, { target: { value: "Retain this draft 🦀" } });
  await screen.findByText(/Couldn’t save this draft/);
  fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() =>
    expect(screen.queryByText(/Couldn’t save this draft/)).toBeNull(),
  );
  expect(mocked.saveDraft).toHaveBeenLastCalledWith(
    first.id,
    "Retain this draft 🦀",
  );
  expect(editor).toHaveValue("Retain this draft 🦀");
  expect(mocked.send).not.toHaveBeenCalled();
});

it("opens connection recovery for an unavailable retry model without switching providers", async () => {
  connectSol();
  mocked.messages.mockResolvedValue({
    items: [
      sentTurn.user,
      {
        ...sentTurn.user,
        id: "failed-gemini",
        role: "assistant",
        model: "gemini:missing",
        content: "Retained partial",
        status: "failed",
        sequence: 2,
      },
    ],
    hasMore: false,
  });
  mocked.draft.mockResolvedValue("Keep this unsent draft");
  render(<App />);
  await screen.findByRole("button", { name: "Model: Sol, Low. Change model" });
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("dialog", { name: "Your connections" });
  expect(
    screen.getByRole("region", { name: "Gemini API setup" }),
  ).toBeVisible();
  expect(mocked.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(
    screen.getByRole("button", { name: "Model: Sol, Low. Change model" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Keep this unsent draft",
  );
  expect(await screen.findByText("Retained partial")).toBeInTheDocument();
});

it("opens a keyboard-contained navigation drawer and returns focus without clearing the draft", async () => {
  const user = userEvent.setup();
  mocked.draft.mockResolvedValue("Keep my place 🦀");
  render(<App />);
  const editor = await screen.findByRole("textbox", { name: "Message" });
  await waitFor(() => expect(editor).toHaveValue("Keep my place 🦀"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.querySelector(".rail")).toBeNull();
  expect(document.querySelector(".composer-footer")).toBeNull();
  const trigger = screen.getByRole("button", { name: "Open navigation" });
  await user.click(trigger);
  const drawer = screen.getByRole("dialog", { name: "Chats" });
  await user.tab();
  expect(drawer).toContainElement(document.activeElement as HTMLElement);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(trigger).toHaveFocus();
  expect(editor).toHaveValue("Keep my place 🦀");
  expect(mocked.send).not.toHaveBeenCalled();
});

it("opens search directly with Ctrl+K and lists temporary chats once", async () => {
  mocked.listChats.mockResolvedValue([
    { ...first, expiresAt: Date.now() + 86_400_000 },
    second,
  ]);
  render(<App />);
  const editor = await screen.findByRole("textbox", { name: "Message" });
  await waitFor(() => expect(editor).toBeEnabled());
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  const search = await screen.findByRole("textbox", {
    name: "Search chat titles",
  });
  await waitFor(() => expect(search).toHaveFocus());
  expect(
    screen.getAllByRole("button", { name: "Open chat First conversation" }),
  ).toHaveLength(1);
  expect(screen.getByLabelText("Deletes in 1 day")).toBeInTheDocument();
  expect(screen.queryByText("Deleting soon")).toBeNull();
});

it("discloses temporary expiry before creation and keeps the new draft path reachable", async () => {
  const user = userEvent.setup();
  const temporaryChat = { ...second, expiresAt: Date.now() + 30 * 86_400_000 };
  mocked.createChat.mockImplementation(async () => {
    mocked.listChats.mockResolvedValue([temporaryChat, first]);
    return temporaryChat;
  });
  render(<App />);
  const editor = await screen.findByRole("textbox", { name: "Message" });
  await waitFor(() => expect(editor).toBeEnabled());
  await openNavigation();
  await user.click(screen.getByRole("button", { name: "Create chat" }));
  const temporary = await screen.findByRole("menuitem", {
    name: /Temporary chat.*Deleted after 30 days/,
  });
  await user.click(temporary);
  await waitFor(() =>
    expect(mocked.createChat).toHaveBeenCalledWith(true, null),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(
    await screen.findByRole("button", { name: "Keep this chat" }),
  ).toBeInTheDocument();
  expect(mocked.send).not.toHaveBeenCalled();
});

it("has one Chat route when a workspace conversation is selected", async () => {
  mocked.workspaces.mockResolvedValue([
    {
      id: "project",
      kind: "projects",
      name: "Writing",
      instructions: "Keep it clear",
    },
  ]);
  mocked.listChats.mockResolvedValue([{ ...first, workspaceId: "project" }]);
  mocked.draft.mockResolvedValue("Keep this workspace draft");
  render(<App />);
  const editor = await screen.findByRole("textbox", { name: "Message" });
  await waitFor(() => expect(editor).toHaveValue("Keep this workspace draft"));
  await openNavigation();
  expect(screen.getAllByRole("button", { name: "Chat" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Chat" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(editor).toHaveValue("Keep this workspace draft");
  expect(mocked.createChat).not.toHaveBeenCalled();
});

it("shows the workspace page title once after navigating", async () => {
  render(<App />);
  await screen.findByRole("textbox", { name: "Message" });
  await openNavigation();
  fireEvent.click(screen.getByRole("button", { name: "Projects" }));
  await screen.findByRole("heading", { name: "Projects" });
  expect(screen.getAllByText("Projects")).toHaveLength(1);
});

it("connects a first model directly from the empty canvas without losing the draft", async () => {
  mocked.draft.mockResolvedValue("My first question");
  render(<App />);
  const editor = await screen.findByRole("textbox", { name: "Message" });
  await waitFor(() => expect(editor).toHaveValue("My first question"));
  fireEvent.click(
    await screen.findByRole("button", { name: "Connect a model" }),
  );
  await screen.findByRole("dialog", { name: "Your connections" });
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(editor).toHaveValue("My first question");
  expect(mocked.send).not.toHaveBeenCalled();
});

it("opens setup directly when sending with no available models", async () => {
  render(<App />);
  const editor = await screen.findByRole("textbox", { name: "Message" });
  await waitFor(() => expect(editor).toBeEnabled());
  await screen.findByRole("button", { name: "Connect a model" });
  fireEvent.change(editor, { target: { value: "Please keep this question" } });
  fireEvent.keyDown(editor, { key: "Enter" });
  await screen.findByRole("dialog", { name: "Your connections" });
  expect(screen.queryByRole("combobox", { name: "Search models" })).toBeNull();
  expect(editor).toHaveValue("Please keep this question");
  expect(mocked.send).not.toHaveBeenCalled();
});

it("leaves navigation and chat creation alone during IME shortcut composition", async () => {
  render(<App />);
  const editor = await screen.findByRole("textbox", { name: "Message" });
  await waitFor(() => expect(editor).toBeEnabled());
  fireEvent.change(editor, { target: { value: "Draft in progress" } });
  fireEvent.keyDown(editor, { key: "k", ctrlKey: true, isComposing: true });
  fireEvent.keyDown(editor, {
    key: "o",
    ctrlKey: true,
    shiftKey: true,
    isComposing: true,
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocked.createChat).not.toHaveBeenCalled();
  expect(editor).toHaveValue("Draft in progress");
});

it("does not switch a favourite model behind modal navigation", async () => {
  const catalog = connectSol();
  mocked.catalog.mockResolvedValue({
    ...catalog,
    models: [
      ...catalog.models,
      { id: "ollama:other", name: "Other", provider: "Ollama" },
    ],
  });
  localStorage.setItem(
    "pavane.models.v1",
    JSON.stringify({
      selected: ["codex:sol"],
      favourites: ["ollama:other"],
      options: {},
      compare: false,
    }),
  );
  render(<App />);
  await screen.findByRole("button", { name: "Model: Sol, Low. Change model" });
  await openNavigation();
  fireEvent.keyDown(window, { key: "1", ctrlKey: true });
  expect(
    JSON.parse(localStorage.getItem("pavane.models.v1")!).selected,
  ).toEqual(["codex:sol"]);
});

it("returns focus when closing chat search", async () => {
  render(<App />);
  await screen.findByRole("textbox", { name: "Message" });
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  const search = await screen.findByRole("textbox", {
    name: "Search chat titles",
  });
  await waitFor(() => expect(search).toHaveFocus());
  fireEvent.click(screen.getByRole("button", { name: "Close search" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Search chats" })).toHaveFocus(),
  );
  expect(
    screen.queryByRole("textbox", { name: "Search chat titles" }),
  ).toBeNull();
});

it("refocuses an existing chat search on Ctrl+K without clearing its query", async () => {
  render(<App />);
  await screen.findByRole("textbox", { name: "Message" });
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  const search = await screen.findByRole("textbox", {
    name: "Search chat titles",
  });
  fireEvent.change(search, { target: { value: "conversation" } });
  screen.getByRole("button", { name: "Close search" }).focus();
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  await waitFor(() => expect(search).toHaveFocus());
  expect(search).toHaveValue("conversation");
});

it("keeps navigation search open during IME Escape and dismisses on ordinary Escape", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("textbox", { name: "Message" });
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  const search = await screen.findByRole("textbox", {
    name: "Search chat titles",
  });
  fireEvent.change(search, { target: { value: "unfinished text" } });
  fireEvent.keyDown(search, { key: "Escape", isComposing: true });
  expect(screen.getByRole("dialog", { name: "Chats" })).toBeInTheDocument();
  expect(search).toHaveValue("unfinished text");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("keeps one native Keep request pending and offers retry after failure", async () => {
  let rejectKeep!: (failure: Error) => void;
  const temporary = { ...first, expiresAt: Date.now() + 30 * 86_400_000 };
  mocked.listChats.mockResolvedValue([temporary, second]);
  mocked.keep.mockReturnValueOnce(
    new Promise<void>((_resolve, reject) => {
      rejectKeep = reject;
    }),
  );
  render(<App />);
  const keep = await screen.findByRole("button", { name: "Keep this chat" });
  fireEvent.click(keep);
  fireEvent.click(keep);
  expect(mocked.keep).toHaveBeenCalledTimes(1);
  expect(keep).toBeDisabled();
  expect(keep).toHaveAttribute("aria-busy", "true");
  await act(async () => rejectKeep(new Error("Synthetic Keep failure")));
  await screen.findByRole("alert");
  expect(keep).toBeEnabled();
  mocked.keep.mockImplementation(async () => {
    mocked.listChats.mockResolvedValue([first, second]);
  });
  fireEvent.click(keep);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Keep this chat" })).toBeNull(),
  );
  expect(mocked.keep).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("serializes new-chat shortcuts and keeps the previous draft after failed creation", async () => {
  let rejectCreate!: (failure: Error) => void;
  mocked.draft.mockImplementation((id: string) =>
    Promise.resolve(id === first.id ? "Previous draft" : ""),
  );
  mocked.createChat
    .mockReturnValueOnce(
      new Promise<Chat>((_resolve, reject) => {
        rejectCreate = reject;
      }),
    )
    .mockResolvedValue(second);
  render(<App />);
  const editor = await screen.findByRole("textbox", { name: "Message" });
  await waitFor(() => expect(editor).toHaveValue("Previous draft"));
  fireEvent.keyDown(window, { key: "o", ctrlKey: true, shiftKey: true });
  fireEvent.keyDown(window, { key: "o", ctrlKey: true, shiftKey: true });
  expect(mocked.createChat).toHaveBeenCalledTimes(1);
  await act(async () => rejectCreate(new Error("Synthetic create failure")));
  await screen.findByRole("alert");
  expect(editor).toHaveValue("Previous draft");
  fireEvent.keyDown(window, { key: "o", ctrlKey: true, shiftKey: true });
  await waitFor(() => expect(mocked.createChat).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(editor).toHaveValue(""));
});

it("freezes one workspace submission and retains failed name/instructions for retry", async () => {
  let rejectCreate!: (failure: Error) => void;
  mocked.createWorkspace.mockReturnValue(
    new Promise((_resolve, reject) => {
      rejectCreate = reject;
    }),
  );
  const user = userEvent.setup();
  render(<App />);
  const editor = await screen.findByRole("textbox", { name: "Message" });
  await waitFor(() => expect(editor).toBeEnabled());
  await openNavigation();
  fireEvent.click(screen.getByRole("button", { name: "Projects" }));
  fireEvent.click(await screen.findByRole("button", { name: "New project" }));
  const dialog = screen.getByRole("dialog", { name: "New project" });
  const name = within(dialog).getByRole("textbox", { name: "Name" });
  const instructions = within(dialog).getByRole("textbox", {
    name: /Instructions/,
  });
  fireEvent.change(name, { target: { value: "My project" } });
  fireEvent.change(instructions, { target: { value: "Keep these rules" } });
  const form = name.closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(mocked.createWorkspace).toHaveBeenCalledTimes(1);
  expect(name).toHaveAttribute("readonly");
  expect(instructions).toHaveAttribute("readonly");
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(
    within(dialog).getByRole("button", { name: "Close dialog" }),
  ).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(dialog).toBeInTheDocument();
  await act(async () => rejectCreate(new Error("Synthetic workspace failure")));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Your entries are still here",
  );
  expect(name).toHaveValue("My project");
  expect(instructions).toHaveValue("Keep these rules");
  expect(within(dialog).getByRole("button", { name: "Create" })).toBeEnabled();
  expect(mocked.createChat).not.toHaveBeenCalled();
});

it("recovers a saved workspace whose first chat fails without creating the workspace again", async () => {
  const saved = {
    id: "saved-project",
    kind: "projects",
    name: "Saved project",
    instructions: "Rules",
  };
  mocked.createWorkspace.mockResolvedValue(saved);
  mocked.createChat.mockRejectedValueOnce(
    new Error("Synthetic first chat failure"),
  );
  const user = userEvent.setup();
  render(<App />);
  const editor = await screen.findByRole("textbox", { name: "Message" });
  await waitFor(() => expect(editor).toBeEnabled());
  await openNavigation();
  fireEvent.click(screen.getByRole("button", { name: "Projects" }));
  fireEvent.click(await screen.findByRole("button", { name: "New project" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
    target: { value: "Saved project" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "was created, but its chat could not be opened",
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
  const linked = { ...second, workspaceId: saved.id };
  mocked.createChat.mockResolvedValue(linked);
  mocked.listChats.mockResolvedValue([first, linked]);
  await user.click(screen.getByRole("button", { name: /Saved project/ }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Edit name and instructions" }),
    ).toBeInTheDocument(),
  );
  expect(mocked.createWorkspace).toHaveBeenCalledTimes(1);
  expect(mocked.createChat).toHaveBeenLastCalledWith(false, saved.id);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("serializes failed deletion, preserves the current draft, and retries only the chosen chat", async () => {
  let rejectDelete!: (failure: Error) => void;
  mocked.draft.mockResolvedValue("Keep my current draft");
  mocked.delete.mockReturnValueOnce(
    new Promise<void>((_resolve, reject) => {
      rejectDelete = reject;
    }),
  );
  const user = userEvent.setup();
  render(<App />);
  const editor = await screen.findByRole("textbox", { name: "Message" });
  await waitFor(() => expect(editor).toHaveValue("Keep my current draft"));
  await openNavigation();
  await user.click(
    screen.getByRole("button", { name: "Options for Second conversation" }),
  );
  await user.click(screen.getByRole("menuitem", { name: "Delete chat" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Delete this chat?",
  });
  const confirm = within(dialog).getByRole("button", { name: "Delete chat" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(mocked.delete).toHaveBeenCalledTimes(1);
  expect(mocked.delete).toHaveBeenCalledWith(second.id);
  expect(confirm).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(dialog).toBeInTheDocument();
  await act(async () => rejectDelete(new Error("Synthetic delete failure")));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "It’s still here",
  );
  expect(confirm).toBeEnabled();
  mocked.delete.mockResolvedValue(undefined);
  mocked.listChats.mockResolvedValue([first]);
  fireEvent.click(confirm);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(editor).toHaveValue("Keep my current draft");
  expect(mocked.delete).toHaveBeenCalledTimes(2);
  expect(mocked.createChat).not.toHaveBeenCalled();
});

it("does not repeat acknowledged deletion when replacement chat creation fails", async () => {
  mocked.delete.mockResolvedValue(undefined);
  mocked.createChat.mockRejectedValueOnce(
    new Error("Synthetic replacement failure"),
  );
  const user = userEvent.setup();
  render(<App />);
  const editor = await screen.findByRole("textbox", { name: "Message" });
  await waitFor(() => expect(editor).toBeEnabled());
  await openNavigation();
  await user.click(
    screen.getByRole("button", { name: "Options for First conversation" }),
  );
  await user.click(screen.getByRole("menuitem", { name: "Delete chat" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Delete this chat?",
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete chat" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The chat was deleted",
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocked.delete).toHaveBeenCalledTimes(1);
  mocked.createChat.mockResolvedValue(second);
  mocked.listChats.mockResolvedValue([second]);
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  await waitFor(() => expect(editor).toBeEnabled());
  expect(mocked.delete).toHaveBeenCalledTimes(1);
});
