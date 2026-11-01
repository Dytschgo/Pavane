import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowUp,
  Bot,
  ChevronDown,
  Clock3,
  Folder,
  HardDrive,
  Layers3,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Menu as MenuIcon,
  SquarePen,
  Pencil,
  Plus,
  Search,
  Settings2,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, errorText, native } from "./lib/api";
import { applyRunEvent, daysRemaining } from "./lib/types";
import type {
  Chat,
  Message,
  Model,
  ProviderStatus,
  RunEvent,
  View,
  Workspace,
} from "./lib/types";
import { Button } from "./components/ui/button";
import { Tip, TooltipProvider } from "./components/ui/tooltip";
import { Modal } from "./components/ui/modal";
import { ModelPicker } from "./components/model-picker";
import { Providers } from "./components/providers";
import { WorkspaceEditor } from "./components/workspace-editor";
import { ChatMessage } from "./components/chat-message";
import { ChatRename } from "./components/chat-rename";
import { useModelPreferences } from "./lib/model-preferences";
import { resolveModelOptions } from "./lib/model-options";
import { DraftWriter, MAX_DRAFT_BYTES } from "./lib/draft-writer";

const views: { id: View; label: string; icon: LucideIcon }[] = [
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "projects", label: "Projects", icon: Folder },
  { id: "spaces", label: "Spaces", icon: Layers3 },
  { id: "bots", label: "Bots", icon: Bot },
];
const descriptions = {
  projects: "Keep a longer piece of work together.",
  spaces: "A place for a topic, with its own context.",
  bots: "A familiar assistant, with instructions you choose.",
};

function expiryText(deadline: number) {
  const days = daysRemaining(deadline);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

const REUSE_LIMIT_ERROR =
  "This prompt would make your draft too long. Shorten your draft first.";

export function App() {
  const [view, setView] = useState<View>("chat");
  const [sidebar, setSidebar] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const { preferences, update: updatePreferences } = useModelPreferences();
  const selectedModels = preferences.selected;
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const discoverVersion = useRef(0);
  const wasRunning = useRef(false);
  const [settings, setSettings] = useState(false);
  const [connectionTarget, setConnectionTarget] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const newChatInFlight = useRef(false);
  const keepInFlight = useRef(new Set<string>());
  const [keepingId, setKeepingId] = useState<string | null>(null);
  const workspaceCreateInFlight = useRef(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [workspaceCreateError, setWorkspaceCreateError] = useState<
    string | null
  >(null);
  const deleteInFlight = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const sendInFlight = useRef(false);
  const retrySend = useRef<(message: Message) => Promise<void>>(async () => {});
  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [moreHistory, setMoreHistory] = useState(false);
  const [hasMoreChats, setHasMoreChats] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [createKind, setCreateKind] = useState<Workspace["kind"] | null>(null);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(
    null,
  );
  const [workspaceName, setWorkspaceName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [draftFailures, setDraftFailures] = useState(() => new Set<string>());
  const selection = useRef(0);
  const currentRef = useRef<string | null>(null);
  const draftCache = useRef(
    new Map<string, { content: string; version: number }>(),
  );
  const draftVersion = useRef(0);
  const listVersion = useRef(0);
  const searchActivated = useRef(false);
  const conversation = useRef<HTMLDivElement>(null);
  const messageList = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);
  const prependAnchor = useRef<{
    chatId: string;
    element: HTMLElement;
    top: number;
  } | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const workspaceEditButton = useRef<HTMLButtonElement>(null);
  const navigationTrigger = useRef<HTMLButtonElement>(null);
  const chatSearch = useRef<HTMLInputElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const drawerFocus = useRef<"trigger" | "composer">("trigger");
  const sidebarOpen = useRef(sidebar);
  useLayoutEffect(() => {
    sidebarOpen.current = sidebar;
  }, [sidebar]);
  const nearBottom = useRef(true);
  const showChat = view === "chat" || !!workspaceId;
  const liveMessages = useRef(new Map<string, Message>());
  const current =
    chats.find((chat) => chat.id === currentId) ??
    (selectedChat?.id === currentId ? selectedChat : undefined);
  const workspace = workspaces.find((item) => item.id === workspaceId);
  const running = messages.some((message) =>
    ["pending", "running"].includes(message.status),
  );
  const waitingForModels = connecting && models.length === 0;
  const draftTooLong = useMemo(
    () => new TextEncoder().encode(draft).byteLength > MAX_DRAFT_BYTES,
    [draft],
  );

  const report = useCallback(
    (failure: unknown) => setError(errorText(failure)),
    [],
  );
  const [draftWriter] = useState(
    () =>
      new DraftWriter(
        api.saveDraft,
        ({ chatId, version }) => {
          if (draftCache.current.get(chatId)?.version === version) {
            draftCache.current.delete(chatId);
            setDraftFailures((previous) => {
              const next = new Set(previous);
              next.delete(chatId);
              return next;
            });
          }
        },
        (_failure, snapshot) =>
          setDraftFailures((previous) =>
            new Set(previous).add(snapshot.chatId),
          ),
        setSaving,
      ),
  );
  const focusComposer = useCallback((chatId?: string) => {
    if (chatId && currentRef.current !== chatId) return;
    const active = document.activeElement;
    if (
      active === document.body ||
      active === composer.current ||
      active?.closest(".composer")
    )
      composer.current?.focus();
  }, []);
  const refresh = useCallback(async () => {
    const version = ++listVersion.current;
    const list = await api.listChats(0, query);
    if (version !== listVersion.current) return list;
    setChats(list);
    setSelectedChat(
      (previous) => list.find((chat) => chat.id === previous?.id) ?? previous,
    );
    setHasMoreChats(list.length === 100);
    return list;
  }, [query]);

  const openChat = useCallback(
    async (chat: Chat) => {
      const version = ++selection.current;
      currentRef.current = chat.id;
      setCurrentId(chat.id);
      setSelectedChat(chat);
      setWorkspaceId(chat.workspaceId);
      setMessages([]);
      setDraft("");
      setLoading(true);
      nearBottom.current = true;
      try {
        await draftWriter.flush();
        const [history, savedDraft] = await Promise.all([
          api.messages(chat.id),
          api.draft(chat.id),
        ]);
        if (selection.current !== version) return;
        setMessages(
          history.items.map(
            (message) => liveMessages.current.get(message.id) ?? message,
          ),
        );
        setMoreHistory(history.hasMore);
        for (const message of history.items) {
          if (!["running", "pending"].includes(message.status))
            liveMessages.current.delete(message.id);
        }
        setDraft(draftCache.current.get(chat.id)?.content ?? savedDraft);
      } catch (failure) {
        if (selection.current === version) report(failure);
      } finally {
        if (selection.current === version) {
          setLoading(false);
          requestAnimationFrame(() => {
            if (drawerFocus.current === "composer" && !sidebarOpen.current) {
              const active = document.activeElement;
              if (
                active === document.body ||
                active === navigationTrigger.current ||
                active === composer.current
              )
                composer.current?.focus();
              drawerFocus.current = "trigger";
            }
          });
        }
      }
    },
    [draftWriter, report],
  );

  useEffect(() => {
    if (!native) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void Promise.all([api.listChats(), api.workspaces()])
      .then(async ([list, savedWorkspaces]) => {
        if (cancelled) return;
        setChats(list);
        setHasMoreChats(list.length === 100);
        setWorkspaces(savedWorkspaces);
        const remembered = localStorage.getItem("pavane.selectedChat");
        const chat = list.find((item) => item.id === remembered) ?? list[0];
        if (chat) await openChat(chat);
        else {
          const first = await api.createChat();
          setChats([first]);
          await openChat(first);
        }
      })
      .catch((failure: unknown) => {
        report(failure);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openChat, report]);

  useEffect(() => {
    if (currentId) localStorage.setItem("pavane.selectedChat", currentId);
  }, [currentId]);

  const followLatest = useCallback(() => {
    const area = conversation.current;
    if (!area || !nearBottom.current) return;
    area.scrollTop = area.scrollHeight;
    lastScrollTop.current = area.scrollTop;
  }, []);

  useLayoutEffect(followLatest, [messages, followLatest]);

  useLayoutEffect(() => {
    const area = conversation.current;
    const list = messageList.current;
    if (!area || !list) return;
    // Deferred Markdown commits and composer/window resizing can happen after
    // the message effect. Follow the rendered size, not just provider events.
    const observer = new ResizeObserver(followLatest);
    observer.observe(list);
    observer.observe(area);
    followLatest();
    return () => observer.disconnect();
  }, [showChat, loading, messages.length, followLatest]);

  useLayoutEffect(() => {
    const anchor = prependAnchor.current;
    if (!anchor) return;
    prependAnchor.current = null;
    const area = conversation.current;
    if (
      !area ||
      currentRef.current !== anchor.chatId ||
      !area.contains(anchor.element)
    )
      return;
    area.scrollTop += anchor.element.getBoundingClientRect().top - anchor.top;
  }, [messages]);

  useEffect(() => {
    if (!native || (!searching && !searchActivated.current)) return;
    searchActivated.current = searching;
    const timer = window.setTimeout(() => {
      void refresh().catch(report);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [searching, refresh, report]);

  useEffect(() => {
    if (!currentId || !current?.expiresAt) return;
    const deadline = current.expiresAt;
    const clearExpired = () => {
      if (currentRef.current !== currentId || Date.now() < deadline) return;
      ++selection.current;
      currentRef.current = null;
      setCurrentId(null);
      setSelectedChat(null);
      setMessages([]);
      setDraft("");
      setLoading(false);
      draftCache.current.delete(currentId);
      for (const [id, message] of liveMessages.current) {
        if (message.chatId === currentId) liveMessages.current.delete(id);
      }
      void refresh().catch(report);
    };
    const timer = window.setTimeout(
      clearExpired,
      Math.min(Math.max(0, deadline - Date.now()), 2_147_483_647),
    );
    const clockCheck = window.setInterval(clearExpired, 1_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(clockCheck);
    };
  }, [currentId, current?.expiresAt, refresh, report]);

  useEffect(() => {
    if (
      !currentId ||
      !running ||
      messages.some(
        (message) =>
          ["pending", "running"].includes(message.status) &&
          liveMessages.current.has(message.id),
      )
    )
      return;
    const target = currentId;
    let pending = false;
    const timer = window.setInterval(() => {
      if (pending) return;
      pending = true;
      void api
        .messages(target)
        .then((page) => {
          if (currentRef.current !== target) return;
          setMessages((previous) => {
            const latest = new Map(
              page.items.map((message) => [message.id, message]),
            );
            return previous.map((message) => latest.get(message.id) ?? message);
          });
        })
        .catch(report)
        .finally(() => {
          pending = false;
        });
    }, 500);
    return () => window.clearInterval(timer);
  }, [currentId, running, messages, report]);

  useEffect(() => {
    if (!native) return;
    const timer = window.setInterval(() => {
      void refresh()
        .then((list) => {
          if (
            currentRef.current &&
            !list.some((chat) => chat.id === currentRef.current)
          ) {
            // Only clear a known expired chat; pagination can hide a retained one.
            const selected = chats.find(
              (chat) => chat.id === currentRef.current,
            );
            if (selected?.expiresAt && selected.expiresAt <= Date.now()) {
              ++selection.current;
              currentRef.current = null;
              setCurrentId(null);
              setMessages([]);
              setDraft("");
            }
          }
        })
        .catch(report);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [chats, refresh, report]);

  const createChat = useCallback(
    async (deleteSoon = false) => {
      if (busy || newChatInFlight.current) return;
      if (
        current &&
        messages.length === 0 &&
        !draft &&
        Boolean(current.expiresAt) === deleteSoon &&
        current.workspaceId === workspaceId
      ) {
        composer.current?.focus();
        return;
      }
      newChatInFlight.current = true;
      setError(null);
      setBusy(true);
      try {
        const chat = await api.createChat(deleteSoon, workspaceId);
        await refresh();
        await openChat(chat);
        composer.current?.focus();
      } catch (failure) {
        report(failure);
      } finally {
        newChatInFlight.current = false;
        setBusy(false);
      }
    },
    [
      workspaceId,
      refresh,
      openChat,
      report,
      current,
      messages.length,
      draft,
      busy,
    ],
  );

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        editingWorkspace ||
        settings ||
        renameId ||
        deleteId ||
        createKind ||
        pickerOpen
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSidebar(true);
        setSearching(true);
        requestAnimationFrame(() => chatSearch.current?.focus());
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "o"
      ) {
        event.preventDefault();
        setView("chat");
        setSidebar(false);
        void createChat();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [
    createChat,
    editingWorkspace,
    settings,
    renameId,
    deleteId,
    createKind,
    pickerOpen,
  ]);

  const changeDraft = useCallback(
    (value: string) => {
      setDraft(value);
      if (!currentId) return;
      const chatId = currentId;
      const version = ++draftVersion.current;
      draftCache.current.set(chatId, { content: value, version });
      if (new TextEncoder().encode(value).byteLength <= MAX_DRAFT_BYTES)
        draftWriter.enqueue({ chatId, content: value, version });
    },
    [currentId, draftWriter],
  );

  const reusePrompt = useCallback(
    (message: Message) => {
      const editor = composer.current;
      if (
        !editor ||
        editor.disabled ||
        message.chatId !== currentRef.current ||
        message.role !== "user" ||
        !message.content
      )
        return;
      // Read the current editor, keeping this callback stable while typing so
      // memoized replies do not re-render for each draft keystroke.
      const combined = editor.value
        ? `${editor.value}\n\n${message.content}`
        : message.content;
      if (new TextEncoder().encode(combined).byteLength > MAX_DRAFT_BYTES) {
        report(REUSE_LIMIT_ERROR);
        return;
      }
      setError((previous) =>
        previous === REUSE_LIMIT_ERROR ? null : previous,
      );
      changeDraft(combined);
      editor.focus();
    },
    [changeDraft, report],
  );

  const stopResponse = useCallback(async (message: Message) => {
    if (
      message.chatId !== currentRef.current ||
      message.role !== "assistant" ||
      !["pending", "running"].includes(message.status)
    )
      return;
    await api.stopResponse(message.chatId, message.id);
  }, []);

  const connect = useCallback(async () => {
    const version = ++discoverVersion.current;
    setConnecting(true);
    setProviderError(null);
    try {
      const catalog = await api.catalog();
      if (version !== discoverVersion.current) return;
      setModels(catalog.models);
      setProviders(catalog.providers);
      updatePreferences((previous) =>
        previous.selected.length
          ? previous
          : {
              ...previous,
              selected: [
                catalog.models.find((model) => model.isDefault)?.id ??
                  catalog.models[0]?.id,
              ].filter((id): id is string => !!id),
            },
      );
    } catch {
      if (version === discoverVersion.current)
        setProviderError(
          "Couldn’t check connections. Your saved setup is unchanged. Recheck to try again.",
        );
    } finally {
      if (version === discoverVersion.current) setConnecting(false);
    }
  }, [updatePreferences]);

  useEffect(() => {
    if (native) void connect();
  }, [connect]);

  useEffect(() => {
    if (
      wasRunning.current &&
      !running &&
      selectedModels.some((id) => id.startsWith("codex:"))
    )
      void connect();
    wasRunning.current = running;
  }, [running, selectedModels, connect]);

  useEffect(() => {
    if (settings && native) void connect();
  }, [settings, connect]);

  useEffect(() => {
    if (!loading && currentId && document.activeElement === document.body)
      composer.current?.focus();
  }, [loading, currentId]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.defaultPrevented ||
        sidebar ||
        pickerOpen ||
        settings ||
        searching ||
        deleteId ||
        renameId ||
        createKind ||
        editingWorkspace
      )
        return;
      if ((event.ctrlKey || event.metaKey) && /^[1-9]$/.test(event.key)) {
        const id = preferences.favourites[Number(event.key) - 1];
        if (id && models.some((model) => model.id === id)) {
          event.preventDefault();
          updatePreferences((previous) => ({
            ...previous,
            selected: [id],
            compare: false,
          }));
          focusComposer();
        }
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [
    preferences.favourites,
    models,
    updatePreferences,
    focusComposer,
    sidebar,
    pickerOpen,
    settings,
    searching,
    deleteId,
    renameId,
    createKind,
    editingWorkspace,
  ]);

  async function send(event?: FormEvent, retry?: Message) {
    event?.preventDefault();
    const sendModels = retry?.model ? [retry.model] : selectedModels;
    if (
      (!retry && !draft.trim()) ||
      sendInFlight.current ||
      busy ||
      running ||
      loading ||
      waitingForModels ||
      (!retry && draftTooLong)
    )
      return;
    if (
      !sendModels.length ||
      sendModels.some((id) => !models.some((model) => model.id === id))
    ) {
      if (retry) {
        setConnectionTarget(retry.model?.split(":")[0] ?? null);
        setSettings(true);
        report(
          "Reconnect this model, then try the response again. Your draft is safe.",
        );
      } else if (models.length === 0) setSettings(true);
      else setPickerOpen(true);
      return;
    }
    if (
      retry &&
      (retry.chatId !== currentId ||
        retry.role !== "assistant" ||
        !["failed", "interrupted", "cancelled"].includes(retry.status))
    )
      return;
    const content = retry ? "" : draft;
    const originTitle =
      current?.title && current.title !== "New chat"
        ? current.title
        : content.trim().replace(/\s+/gu, " ").slice(0, 72);
    let submittedChatId = currentId;
    const reportSendError = (failure: unknown, modelId?: string) => {
      const name = models.find((model) => model.id === modelId)?.name;
      report(
        `In “${originTitle}”${name ? ` · ${name}` : ""}: ${errorText(failure)}`,
      );
    };
    sendInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await draftWriter.flush();
      let chatId = currentId;
      if (!chatId) {
        const chat = await api.createChat(false, workspaceId);
        chatId = chat.id;
        currentRef.current = chatId;
        setCurrentId(chatId);
        setSelectedChat(chat);
        setChats((previous) => [chat, ...previous]);
      }
      const target = chatId;
      submittedChatId = target;
      let ready = false;
      const buffered: RunEvent[] = [];
      const receive = (update: RunEvent) => {
        if (!ready) {
          buffered.push(update);
          return;
        }
        const existing = liveMessages.current.get(update.messageId);
        if (existing)
          liveMessages.current.set(
            update.messageId,
            applyRunEvent([existing], update)[0],
          );
        if (liveMessages.current.size > 16) {
          for (const [id, message] of liveMessages.current) {
            if (liveMessages.current.size <= 16) break;
            if (!["pending", "running"].includes(message.status))
              liveMessages.current.delete(id);
          }
        }
        if (currentRef.current === target)
          setMessages((previous) => applyRunEvent(previous, update));
        if (update.kind === "finished") {
          if (
            update.error &&
            update.status !== "cancelled" &&
            currentRef.current !== target
          )
            reportSendError(update.error, existing?.model ?? undefined);
          void refresh().catch(report);
        }
      };
      const started = await api.send(
        target,
        content,
        sendModels,
        receive,
        Object.fromEntries(
          sendModels.map((id) => {
            const model = models.find((model) => model.id === id)!;
            return [id, resolveModelOptions(model, preferences.options[id])];
          }),
        ),
        ...(retry ? ([retry.id] as const) : []),
      );
      if (!retry) {
        draftCache.current.delete(target);
        setDraftFailures((previous) => {
          const next = new Set(previous);
          next.delete(target);
          return next;
        });
      }
      const placeholders: Message[] = started.runs.map((run, index) => ({
        id: run.messageId,
        chatId: target,
        role: "assistant",
        content: "",
        model: run.model,
        status: "pending",
        createdAt: Date.now(),
        sequence:
          (retry
            ? Math.max(
                started.user.sequence,
                ...messages.map((message) => message.sequence),
              )
            : started.user.sequence) +
          index +
          1,
      }));
      for (const message of placeholders)
        liveMessages.current.set(message.id, message);
      for (const update of buffered) {
        const existing = liveMessages.current.get(update.messageId);
        if (existing)
          liveMessages.current.set(
            update.messageId,
            applyRunEvent([existing], update)[0],
          );
      }
      if (currentRef.current === target) {
        setMessages((previous) =>
          buffered.reduce(applyRunEvent, [
            ...previous,
            ...(retry ? [] : [started.user]),
            ...placeholders,
          ]),
        );
        if (!retry) setDraft("");
      }
      ready = true;
      for (const update of buffered) {
        if (
          update.kind === "finished" &&
          update.error &&
          update.status !== "cancelled" &&
          currentRef.current !== target
        )
          reportSendError(
            update.error,
            liveMessages.current.get(update.messageId)?.model ?? undefined,
          );
      }
      nearBottom.current = true;
      await refresh();
    } catch (failure) {
      reportSendError(failure);
    } finally {
      sendInFlight.current = false;
      setBusy(false);
      requestAnimationFrame(() => focusComposer(submittedChatId ?? undefined));
    }
  }

  useLayoutEffect(() => {
    retrySend.current = (message) => send(undefined, message);
  });
  const retryResponse = useCallback(
    (message: Message) => retrySend.current(message),
    [],
  );

  async function older() {
    if (!currentId || !messages.length) return;
    const target = currentId;
    setLoadingHistory(true);
    try {
      const history = await api.messages(target, messages[0].sequence);
      if (currentRef.current !== target) return;
      const area = conversation.current;
      if (area) {
        const edge = area.getBoundingClientRect().top;
        const element = [
          ...area.querySelectorAll<HTMLElement>(".message"),
        ].find((item) => item.getBoundingClientRect().bottom > edge);
        if (element)
          prependAnchor.current = {
            chatId: target,
            element,
            top: element.getBoundingClientRect().top,
          };
      }
      nearBottom.current = false;
      setMessages((previous) => [...history.items, ...previous]);
      setMoreHistory(history.hasMore);
    } catch (failure) {
      report(failure);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function moreChats() {
    try {
      const list = await api.listChats(chats.length, query);
      setChats((previous) => [...previous, ...list]);
      setHasMoreChats(list.length === 100);
    } catch (failure) {
      report(failure);
    }
  }

  async function saveWorkspace(event: FormEvent) {
    event.preventDefault();
    if (!createKind || !workspaceName.trim() || workspaceCreateInFlight.current)
      return;
    workspaceCreateInFlight.current = true;
    setCreatingWorkspace(true);
    setWorkspaceCreateError(null);
    setBusy(true);
    let created: Workspace | null = null;
    try {
      const saved = await api.createWorkspace(
        createKind,
        workspaceName.trim(),
        instructions,
      );
      created = saved;
      setWorkspaces((previous) =>
        previous.some((item) => item.id === saved.id)
          ? previous
          : [...previous, saved],
      );
      const firstChat = await api.createChat(false, saved.id);
      await refresh();
      await openChat(firstChat);
      setCreateKind(null);
      setWorkspaceName("");
      setInstructions("");
    } catch {
      if (created) {
        setCreateKind(null);
        setWorkspaceName("");
        setInstructions("");
        report(
          `“${created.name}” was created, but its chat could not be opened. Open the saved workspace to continue.`,
        );
      } else {
        setWorkspaceCreateError(
          "Couldn’t create this workspace. Your entries are still here. Try again.",
        );
      }
    } finally {
      workspaceCreateInFlight.current = false;
      setCreatingWorkspace(false);
      setBusy(false);
    }
  }

  function navigate(next: View) {
    setView(next);
    setWorkspaceId(null);
    setSidebar(false);
  }

  async function keepChat(id: string) {
    if (keepInFlight.current.has(id)) return;
    keepInFlight.current.add(id);
    setError(null);
    setKeepingId(id);
    try {
      await api.keep(id);
      setSelectedChat((previous) =>
        previous?.id === id ? { ...previous, expiresAt: null } : previous,
      );
      setChats((previous) =>
        previous.map((chat) =>
          chat.id === id ? { ...chat, expiresAt: null } : chat,
        ),
      );
      await refresh();
    } finally {
      keepInFlight.current.delete(id);
      setKeepingId((previous) => (previous === id ? null : previous));
    }
  }

  async function deleteChat() {
    if (!deleteId || deleteInFlight.current) return;
    const target = deleteId;
    deleteInFlight.current = true;
    setDeleting(true);
    setDeleteError(null);
    let deleted = false;
    let stage: "delete" | "replacement" | "refresh" = "delete";
    try {
      await api.delete(target);
      deleted = true;
      setChats((previous) => previous.filter((chat) => chat.id !== target));
      setSidebar(false);
      setDeleteId(null);
      if (currentRef.current === target) {
        stage = "replacement";
        ++selection.current;
        currentRef.current = null;
        setCurrentId(null);
        setSelectedChat(null);
        setMessages([]);
        setDraft("");
        setLoading(true);
        const replacement = await api.createChat(false, workspaceId);
        await openChat(replacement);
      }
      stage = "refresh";
      await refresh();
    } catch {
      if (deleted) {
        if (stage === "replacement") {
          setLoading(false);
          report(
            "The chat was deleted. Couldn’t open a replacement chat. Choose New chat to continue.",
          );
        } else {
          report("The chat was deleted. The chat list could not be refreshed.");
        }
      } else
        setDeleteError(
          "Couldn’t delete this chat. It’s still here. Try again.",
        );
    } finally {
      deleteInFlight.current = false;
      setDeleting(false);
    }
  }

  async function openWorkspace(item: Workspace) {
    setError(null);
    setBusy(true);
    try {
      const chat =
        chats.find((candidate) => candidate.workspaceId === item.id) ??
        (await api.createChat(false, item.id));
      await refresh();
      await openChat(chat);
    } catch (failure) {
      report(failure);
    } finally {
      setBusy(false);
    }
  }
  const visibleChats = chats.filter(
    (chat) =>
      (!workspaceId || chat.workspaceId === workspaceId) &&
      chat.title.toLowerCase().includes(query.toLowerCase()),
  );
  const viewInfo = views.find((item) => item.id === view)!;

  const retryable = new Set<string>();
  const seenModels = new Set<string>();
  for (const message of [...messages].reverse()) {
    if (message.role === "user") break;
    if (message.model && !seenModels.has(message.model)) {
      seenModels.add(message.model);
      if (["failed", "interrupted", "cancelled"].includes(message.status))
        retryable.add(message.id);
    }
  }

  function chatRows(list: Chat[]) {
    return list.map((chat) => (
      <div
        className={`chat-row ${chat.id === currentId && showChat ? "selected" : ""}`}
        key={chat.id}
      >
        <button
          className="chat-select"
          aria-label={`Open chat ${chat.title}`}
          onClick={() => {
            if (view !== "chat" && !workspaceId) setView("chat");
            drawerFocus.current = "composer";
            setSidebar(false);
            void openChat(chat);
          }}
        >
          {chat.expiresAt ? <Clock3 size={15} /> : <MessageCircle size={15} />}
          <span>{chat.title}</span>
          {chat.expiresAt && (
            <small aria-label={`Deletes in ${expiryText(chat.expiresAt)}`}>
              {daysRemaining(chat.expiresAt)}d
            </small>
          )}
        </button>
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="row-menu"
              aria-label={`Options for ${chat.title}`}
            >
              <MoreHorizontal size={15} />
            </Button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content className="context-menu" align="end">
              <Menu.Item
                className="menu-item"
                onSelect={() => {
                  setRenameTitle(chat.title);
                  setRenameId(chat.id);
                }}
              >
                <Pencil size={14} />
                Rename
              </Menu.Item>
              <Menu.Separator className="menu-separator" />
              <Menu.Item
                className="menu-item destructive"
                onSelect={() => {
                  setDeleteError(null);
                  setDeleteId(chat.id);
                }}
              >
                <Trash2 size={14} />
                Delete chat
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>
    ));
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="app-shell" data-sidebar={sidebar}>
        <Dialog.Root open={sidebar} onOpenChange={setSidebar}>
          <Dialog.Portal>
            <Dialog.Overlay className="navigation-overlay" />
            <Dialog.Content
              className="sidebar navigation-drawer"
              aria-describedby={undefined}
              onEscapeKeyDown={(event) => {
                if (event.isComposing) event.preventDefault();
              }}
              onOpenAutoFocus={(event) => {
                if (searching) {
                  event.preventDefault();
                  chatSearch.current?.focus();
                }
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (settings || renameId || deleteId || editingWorkspace)
                  return;
                const target =
                  drawerFocus.current === "composer" && showChat
                    ? composer.current
                    : navigationTrigger.current;
                if (!target?.hasAttribute("disabled")) {
                  drawerFocus.current = "trigger";
                  target?.focus();
                }
              }}
            >
              <div className="sidebar-heading">
                <Dialog.Title>Chats</Dialog.Title>
                <div className="inline-actions">
                  <Tip label="Search chats · Ctrl+K">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Search chats"
                      ref={searchTrigger}
                      onClick={() => setSearching((value) => !value)}
                    >
                      <Search size={17} />
                    </Button>
                  </Tip>
                  <Dialog.Close asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Close navigation"
                    >
                      <X size={18} />
                    </Button>
                  </Dialog.Close>
                </div>
              </div>
              {searching && (
                <div className="sidebar-search">
                  <Search size={15} />
                  <input
                    ref={chatSearch}
                    autoFocus
                    placeholder="Search chats…"
                    aria-label="Search chat titles"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Close search"
                    onClick={() => {
                      setSearching(false);
                      setQuery("");
                      requestAnimationFrame(() =>
                        searchTrigger.current?.focus(),
                      );
                    }}
                  >
                    <X size={14} />
                  </Button>
                </div>
              )}
              <div className="sidebar-actions">
                <Menu.Root>
                  <Menu.Trigger asChild>
                    <Button
                      variant="secondary"
                      aria-label="Create chat"
                      disabled={busy}
                    >
                      <Plus size={16} />
                      New chat
                      <ChevronDown size={14} />
                    </Button>
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Content className="context-menu" align="start">
                      <Menu.Item
                        className="menu-item"
                        onSelect={() => {
                          if (!showChat) setView("chat");
                          drawerFocus.current = "composer";
                          setSidebar(false);
                          void createChat();
                        }}
                      >
                        <Plus size={15} />
                        New chat
                      </Menu.Item>
                      <Menu.Item
                        className="menu-item"
                        onSelect={() => {
                          if (!showChat) setView("chat");
                          drawerFocus.current = "composer";
                          setSidebar(false);
                          void createChat(true);
                        }}
                      >
                        <Clock3 size={15} />
                        <span>
                          Temporary chat<small>Deleted after 30 days</small>
                        </span>
                      </Menu.Item>
                    </Menu.Content>
                  </Menu.Portal>
                </Menu.Root>
              </div>
              <nav className="drawer-workflows" aria-label="Workflows">
                {views.map(({ id, label, icon: Icon }) => (
                  <Button
                    key={id}
                    variant="ghost"
                    aria-current={view === id ? "page" : undefined}
                    onClick={() => navigate(id)}
                  >
                    <Icon size={17} />
                    {label}
                  </Button>
                ))}
              </nav>
              <div className="sidebar-scroll">
                <div className="list-label">
                  <span className="list-title" title={workspace?.name}>
                    {workspace ? workspace.name : "Recent chats"}
                  </span>
                </div>
                {chatRows(visibleChats)}
                {visibleChats.length === 0 && (
                  <p className="sidebar-empty">
                    {query ? "No matching chats" : "No chats yet"}
                  </p>
                )}
                {hasMoreChats && (
                  <Button
                    variant="ghost"
                    size="small"
                    className="more-chats"
                    onClick={() => void moreChats()}
                  >
                    More chats
                    <ChevronDown size={13} />
                  </Button>
                )}
              </div>
              <Button
                className="drawer-connections"
                variant="ghost"
                onClick={() => {
                  setSidebar(false);
                  setSettings(true);
                }}
              >
                <Settings2 size={17} />
                Connections
              </Button>
            </Dialog.Content>
          </Dialog.Portal>
          <main
            className="main-pane"
            data-empty={showChat && !loading && messages.length === 0}
          >
            <header className="main-header">
              <Dialog.Trigger asChild>
                <Button
                  ref={navigationTrigger}
                  className="navigation-trigger"
                  variant="ghost"
                  aria-label="Open navigation"
                >
                  <MenuIcon size={19} />
                  <span>Chats</span>
                </Button>
              </Dialog.Trigger>
              <div className="header-location">
                <span className="header-title">
                  {showChat ? (current?.title ?? "New chat") : ""}
                </span>
                {workspace && (
                  <Tip label="Edit name and instructions">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Edit name and instructions"
                      ref={workspaceEditButton}
                      onClick={() => setEditingWorkspace(workspace)}
                    >
                      <Pencil size={14} />
                    </Button>
                  </Tip>
                )}
                {showChat && current?.expiresAt && (
                  <div className="retention-notice">
                    <span
                      title={`Deletes in ${expiryText(current.expiresAt)}.`}
                    >
                      Temporary · {expiryText(current.expiresAt)}
                    </span>
                    <button
                      aria-label="Keep this chat"
                      aria-busy={keepingId === current.id}
                      disabled={keepingId === current.id}
                      onClick={() => void keepChat(current.id).catch(report)}
                    >
                      {keepingId === current.id ? "Keeping…" : "Keep"}
                    </button>
                  </div>
                )}
              </div>
              <Tip label="New chat · Ctrl+Shift+O">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="New chat"
                  disabled={busy}
                  onClick={() => {
                    if (!showChat) setView("chat");
                    void createChat();
                  }}
                >
                  <SquarePen size={19} />
                </Button>
              </Tip>
            </header>
            {!native && (
              <div className="preview-notice">
                Interface preview · Open the desktop app for SQLite storage and
                model connections.
              </div>
            )}
            {error && (
              <div className="error-banner" role="alert">
                <span>{error}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Dismiss error"
                  onClick={() => setError(null)}
                >
                  <X size={16} />
                </Button>
              </div>
            )}
            {showChat ? (
              <>
                <div
                  ref={conversation}
                  className={`conversation ${messages.length ? "has-messages" : ""}`}
                  onWheel={(event) => {
                    if (
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.defaultPrevented
                    )
                      return;
                    const area = event.currentTarget;
                    if (
                      !(event.target instanceof Element) ||
                      !area.contains(event.target)
                    )
                      return;
                    // Leave gestures in independently scrolling content alone.
                    for (
                      let node: Element | null = event.target;
                      node && node !== area;
                      node = node.parentElement
                    ) {
                      if (
                        node.clientHeight > 0 &&
                        node.scrollHeight > node.clientHeight + 1 &&
                        ["auto", "scroll"].includes(
                          getComputedStyle(node).overflowY,
                        )
                      )
                        return;
                    }
                    if (event.deltaY < 0) nearBottom.current = false;
                    else if (
                      event.deltaY > 0 &&
                      event.deltaMode === 0 &&
                      event.deltaY >=
                        area.scrollHeight - area.scrollTop - area.clientHeight
                    )
                      // Capture intent before deferred growth changes the bottom
                      // between native wheel scrolling and its scroll event.
                      nearBottom.current = true;
                  }}
                  onScroll={(event) => {
                    const el = event.currentTarget;
                    const atLatest =
                      el.scrollHeight - el.scrollTop - el.clientHeight < 100;
                    // Growing content can emit scroll events without an upward
                    // move. That must not turn a pinned reader into an unpinned one.
                    if (el.scrollTop < lastScrollTop.current - 1 || atLatest)
                      nearBottom.current = atLatest;
                    lastScrollTop.current = el.scrollTop;
                  }}
                  aria-label="Conversation"
                >
                  {loading ? (
                    <div className="loading-state" role="status">
                      <LoaderCircle className="spin" size={22} />
                      <span>Opening your chat…</span>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="welcome">
                      <h1>What’s on your mind?</h1>
                      {native && !connecting && models.length === 0 && (
                        <Button
                          className="welcome-connect"
                          onClick={() => setSettings(true)}
                        >
                          <Plus size={16} />
                          Connect a model
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="message-list" ref={messageList}>
                      {moreHistory && (
                        <Button
                          variant="ghost"
                          size="small"
                          onClick={() => void older()}
                          disabled={loadingHistory}
                        >
                          {loadingHistory ? (
                            <LoaderCircle className="spin" size={14} />
                          ) : (
                            <ArrowUp size={14} />
                          )}
                          Load earlier messages
                        </Button>
                      )}
                      {messages.map((message) => (
                        <ChatMessage
                          key={message.id}
                          message={message}
                          models={models}
                          onError={report}
                          onReuse={reusePrompt}
                          onStop={stopResponse}
                          onRetry={
                            retryable.has(message.id)
                              ? retryResponse
                              : undefined
                          }
                          retryDisabled={loading || busy || running}
                          reuseDisabled={loading || busy}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div className="composer-region">
                  {currentId &&
                    draftFailures.has(currentId) &&
                    !saving &&
                    !draftTooLong && (
                      <p className="composer-error" role="alert">
                        Couldn’t save this draft. Your text is still here.
                        <Button
                          size="small"
                          variant="ghost"
                          onClick={() => {
                            const snapshot = draftCache.current.get(currentId);
                            if (snapshot)
                              draftWriter.enqueue({
                                chatId: currentId,
                                ...snapshot,
                              });
                          }}
                        >
                          Retry save
                        </Button>
                      </p>
                    )}
                  {draftTooLong && (
                    <p className="composer-error" id="draft-limit" role="alert">
                      This message is too long to save or send. Shorten it
                      first. Your text is still here.
                    </p>
                  )}
                  <form
                    className="composer"
                    onSubmit={(event) => void send(event)}
                  >
                    <label className="sr-only" htmlFor="prompt">
                      Message
                    </label>
                    <textarea
                      ref={composer}
                      id="prompt"
                      rows={2}
                      placeholder={
                        running
                          ? "Write your next message… Esc to stop"
                          : "Ask anything…"
                      }
                      value={draft}
                      aria-invalid={draftTooLong || undefined}
                      aria-describedby={
                        draftTooLong ? "draft-limit" : undefined
                      }
                      onChange={(event) => changeDraft(event.target.value)}
                      disabled={loading || busy || (native && !currentId)}
                      maxLength={65536}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Escape" &&
                          !event.nativeEvent.isComposing &&
                          running &&
                          currentId
                        ) {
                          event.preventDefault();
                          void api.stop(currentId).catch(report);
                          return;
                        }
                        if (
                          !running &&
                          event.key === "Enter" &&
                          !event.shiftKey &&
                          !event.nativeEvent.isComposing
                        ) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                    />
                    <div className="composer-toolbar">
                      <div className="composer-model">
                        <ModelPicker
                          models={models}
                          preferences={preferences}
                          update={updatePreferences}
                          open={pickerOpen}
                          onOpenChange={setPickerOpen}
                          connecting={connecting}
                          onConnect={() => {
                            setPickerOpen(false);
                            setSettings(true);
                          }}
                          onSelected={() =>
                            focusComposer(currentId ?? undefined)
                          }
                        />
                        {running ? (
                          <Button
                            variant="primary"
                            size="icon"
                            aria-label="Stop responses"
                            onClick={() => {
                              if (currentId)
                                void api.stop(currentId).catch(report);
                            }}
                          >
                            <Square size={13} fill="currentColor" />
                          </Button>
                        ) : (
                          <Button
                            variant="primary"
                            size="icon"
                            type="submit"
                            aria-label={
                              waitingForModels
                                ? "Connecting models"
                                : "Send message"
                            }
                            disabled={
                              !draft.trim() ||
                              busy ||
                              loading ||
                              waitingForModels ||
                              draftTooLong
                            }
                          >
                            {busy || waitingForModels ? (
                              <LoaderCircle className="spin" size={16} />
                            ) : (
                              <ArrowUp size={20} />
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  </form>
                  <output className="sr-only" aria-live="off">
                    {saving
                      ? "Saving draft…"
                      : currentId && draftCache.current.has(currentId)
                        ? "Draft not saved"
                        : native
                          ? "Saved on this device"
                          : "Desktop preview"}
                  </output>
                </div>
              </>
            ) : (
              <div className="workspace-page">
                <div className="page-title-row">
                  <div>
                    <h1>{viewInfo.label}</h1>
                    <p>{descriptions[view as keyof typeof descriptions]}</p>
                  </div>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => {
                      setWorkspaceCreateError(null);
                      setCreateKind(view as Workspace["kind"]);
                    }}
                  >
                    <Plus size={16} />
                    New{" "}
                    {view === "bots"
                      ? "bot"
                      : view === "spaces"
                        ? "space"
                        : "project"}
                  </Button>
                </div>
                {workspaces.filter((item) => item.kind === view).length ? (
                  <div className="workspace-grid">
                    {workspaces
                      .filter((item) => item.kind === view)
                      .map((item) => (
                        <button
                          className="workspace-card"
                          key={item.id}
                          disabled={busy}
                          onClick={() => void openWorkspace(item)}
                        >
                          <viewInfo.icon size={23} strokeWidth={1.5} />
                          <h2>{item.name}</h2>
                          {item.instructions && <p>{item.instructions}</p>}
                          <span aria-hidden="true">
                            <ArrowUp size={13} />
                          </span>
                        </button>
                      ))}
                  </div>
                ) : (
                  <div className="workspace-empty">
                    <viewInfo.icon size={42} strokeWidth={1} />
                    <h2>No {view} yet.</h2>
                  </div>
                )}
              </div>
            )}
          </main>
        </Dialog.Root>
        <Modal
          open={settings}
          onOpenChange={(open) => {
            setSettings(open);
            if (!open) setConnectionTarget(null);
          }}
          returnFocus={() => navigationTrigger.current}
          title="Your connections"
          description="Bring your models into one workspace."
          wide
        >
          <Providers
            initialProvider={
              connectionTarget ?? selectedModels[0]?.split(":")[0] ?? "codex"
            }
            models={models}
            providers={providers}
            busy={connecting}
            onRefresh={() => void connect()}
            onCredentialsChanged={(providerId) => {
              setModels((previous) =>
                previous.filter(
                  (model) => model.provider.toLowerCase() !== providerId,
                ),
              );
              setProviders((previous) =>
                previous.filter((provider) => provider.id !== providerId),
              );
              void connect();
            }}
            error={providerError}
          />
          <div className="settings-bottom">
            <HardDrive size={15} />
            <span>
              Chats and saved keys stay on this device. Your chosen provider
              receives the conversation when you send.
            </span>
          </div>
        </Modal>
        <Modal
          open={!!deleteId}
          dismissible={!deleting}
          onOpenChange={(open) => {
            if (!open && !deleteInFlight.current) {
              setDeleteId(null);
              setDeleteError(null);
            }
          }}
          title="Delete this chat?"
          description="This removes the conversation from this device. It cannot be undone."
        >
          {deleteError && (
            <p className="field-error" role="alert">
              {deleteError}
            </p>
          )}
          <div className="dialog-actions">
            <Button disabled={deleting} onClick={() => setDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              aria-label="Delete chat"
              aria-busy={deleting}
              disabled={deleting}
              onClick={() => void deleteChat()}
            >
              <Trash2 size={15} />
              {deleting ? "Deleting…" : "Delete chat"}
            </Button>
          </div>
        </Modal>
        {renameId && (
          <ChatRename
            key={renameId}
            chatId={renameId}
            title={renameTitle}
            onClose={() => setRenameId(null)}
            onSaved={(title) => {
              setSelectedChat((previous) =>
                previous?.id === renameId ? { ...previous, title } : previous,
              );
              setChats((previous) =>
                previous.map((chat) =>
                  chat.id === renameId ? { ...chat, title } : chat,
                ),
              );
              setRenameId(null);
              void refresh().catch(report);
            }}
          />
        )}
        {editingWorkspace && (
          <WorkspaceEditor
            key={editingWorkspace.id}
            workspace={editingWorkspace}
            onUpdate={(saved) =>
              setWorkspaces((previous) =>
                previous.map((item) => (item.id === saved.id ? saved : item)),
              )
            }
            onClose={() => {
              const trigger = workspaceEditButton.current;
              setEditingWorkspace(null);
              requestAnimationFrame(() => {
                if (
                  trigger?.isConnected &&
                  document.activeElement === document.body
                )
                  trigger.focus();
              });
            }}
          />
        )}
        <Modal
          open={!!createKind}
          dismissible={!creatingWorkspace}
          onOpenChange={(open) => {
            if (!open && !workspaceCreateInFlight.current) setCreateKind(null);
          }}
          title={`New ${createKind === "bots" ? "bot" : createKind === "spaces" ? "space" : "project"}`}
          description="A dedicated place for conversations and shared instructions."
        >
          <form
            aria-busy={creatingWorkspace}
            onSubmit={(event) => void saveWorkspace(event)}
          >
            {workspaceCreateError && (
              <p className="field-error" role="alert">
                {workspaceCreateError}
              </p>
            )}
            <label className="field-label" htmlFor="workspace-name">
              Name
            </label>
            <input
              className="text-input"
              id="workspace-name"
              readOnly={creatingWorkspace}
              value={workspaceName}
              maxLength={80}
              onChange={(event) => setWorkspaceName(event.target.value)}
              required
            />
            <label className="field-label" htmlFor="instructions">
              Instructions <span>optional</span>
            </label>
            <textarea
              className="text-input instructions-input"
              id="instructions"
              readOnly={creatingWorkspace}
              placeholder="How should the assistant work here?"
              value={instructions}
              maxLength={8192}
              onChange={(event) => setInstructions(event.target.value)}
            />
            <div className="dialog-actions">
              <Button
                type="button"
                disabled={creatingWorkspace}
                onClick={() => setCreateKind(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={busy || !workspaceName.trim()}
              >
                {creatingWorkspace ? "Creating…" : "Create"}
              </Button>
            </div>
          </form>
        </Modal>
      </div>
    </TooltipProvider>
  );
}
