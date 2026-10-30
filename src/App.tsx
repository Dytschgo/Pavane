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
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  Clock3,
  Folder,
  HardDrive,
  Image,
  Layers3,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Video,
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
import { ChatMessage } from "./components/chat-message";
import { useModelPreferences } from "./lib/model-preferences";
import { resolveModelOptions } from "./lib/model-options";
import { DraftWriter, MAX_DRAFT_BYTES } from "./lib/draft-writer";

const views: { id: View; label: string; icon: LucideIcon }[] = [
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "projects", label: "Projects", icon: Folder },
  { id: "spaces", label: "Spaces", icon: Layers3 },
  { id: "bots", label: "Bots", icon: Bot },
  { id: "images", label: "Images", icon: Image },
  { id: "videos", label: "Videos", icon: Video },
];
const descriptions = {
  projects: "Keep a longer piece of work together.",
  spaces: "A place for a topic, with its own context.",
  bots: "A familiar assistant, with instructions you choose.",
};

export function App() {
  const [view, setView] = useState<View>("chat");
  const [sidebar, setSidebar] = useState(true);
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
  const [connecting, setConnecting] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [moreHistory, setMoreHistory] = useState(false);
  const [hasMoreChats, setHasMoreChats] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [createKind, setCreateKind] = useState<Workspace["kind"] | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [roadmap, setRoadmap] = useState(false);
  const [saving, setSaving] = useState(false);
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
          if (draftCache.current.get(chatId)?.version === version)
            draftCache.current.delete(chatId);
        },
        report,
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
        if (selection.current === version) setLoading(false);
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
      setBusy(true);
      try {
        const chat = await api.createChat(deleteSoon, workspaceId);
        await refresh();
        await openChat(chat);
        composer.current?.focus();
      } catch (failure) {
        report(failure);
      } finally {
        setBusy(false);
      }
    },
    [workspaceId, refresh, openChat, report, current, messages.length, draft],
  );

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSidebar(true);
        setSearching((value) => !value);
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "o"
      ) {
        event.preventDefault();
        setView("chat");
        void createChat();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [createChat]);

  function changeDraft(value: string) {
    setDraft(value);
    if (!currentId) return;
    const chatId = currentId;
    const version = ++draftVersion.current;
    draftCache.current.set(chatId, { content: value, version });
    if (new TextEncoder().encode(value).byteLength <= MAX_DRAFT_BYTES)
      draftWriter.enqueue({ chatId, content: value, version });
  }

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
      if (!catalog.models.length)
        setProviderError(
          catalog.providers.find((provider) => provider.id === "codex")
            ?.detail ?? "Connect a model to get started.",
        );
    } catch (failure) {
      if (version === discoverVersion.current)
        setProviderError(errorText(failure));
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
        event.defaultPrevented ||
        pickerOpen ||
        settings ||
        searching ||
        deleteId ||
        renameId ||
        createKind
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
    pickerOpen,
    settings,
    searching,
    deleteId,
    renameId,
    createKind,
  ]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (
      !draft.trim() ||
      busy ||
      running ||
      loading ||
      waitingForModels ||
      draftTooLong
    )
      return;
    if (
      !selectedModels.length ||
      selectedModels.some((id) => !models.some((model) => model.id === id))
    ) {
      setPickerOpen(true);
      return;
    }
    const content = draft;
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
          if (update.error && update.status !== "cancelled")
            reportSendError(update.error, existing?.model ?? undefined);
          void refresh().catch(report);
        }
      };
      const started = await api.send(
        target,
        content,
        selectedModels,
        receive,
        Object.fromEntries(
          selectedModels.map((id) => {
            const model = models.find((model) => model.id === id)!;
            return [id, resolveModelOptions(model, preferences.options[id])];
          }),
        ),
      );
      draftCache.current.delete(target);
      const placeholders: Message[] = started.runs.map((run, index) => ({
        id: run.messageId,
        chatId: target,
        role: "assistant",
        content: "",
        model: run.model,
        status: "pending",
        createdAt: Date.now(),
        sequence: started.user.sequence + index + 1,
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
            started.user,
            ...placeholders,
          ]),
        );
        setDraft("");
      }
      ready = true;
      for (const update of buffered) {
        if (
          update.kind === "finished" &&
          update.error &&
          update.status !== "cancelled"
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
      setBusy(false);
      requestAnimationFrame(() => focusComposer(submittedChatId ?? undefined));
    }
  }

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
    if (!createKind) return;
    setBusy(true);
    try {
      const saved = await api.createWorkspace(
        createKind,
        workspaceName,
        instructions,
      );
      setWorkspaces((previous) => [...previous, saved]);
      setWorkspaceId(saved.id);
      const firstChat = await api.createChat(false, saved.id);
      await refresh();
      await openChat(firstChat);
      setCreateKind(null);
      setWorkspaceName("");
      setInstructions("");
    } catch (failure) {
      report(failure);
    } finally {
      setBusy(false);
    }
  }

  function navigate(next: View) {
    setView(next);
    setWorkspaceId(null);
  }

  async function keepChat(id: string) {
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
  }

  async function openWorkspace(item: Workspace) {
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
  const permanent = visibleChats.filter((chat) => !chat.expiresAt);
  const temporary = visibleChats.filter((chat) => chat.expiresAt);
  const viewInfo = views.find((item) => item.id === view)!;

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
            void openChat(chat);
          }}
        >
          <MessageCircle size={15} />
          <span>{chat.title}</span>
          {chat.expiresAt && <small>{daysRemaining(chat.expiresAt)}d</small>}
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
              {chat.expiresAt && (
                <Menu.Item
                  className="menu-item"
                  onSelect={() => {
                    void keepChat(chat.id).catch(report);
                  }}
                >
                  <ShieldCheck size={14} />
                  Keep this chat
                </Menu.Item>
              )}
              <Menu.Separator className="menu-separator" />
              <Menu.Item
                className="menu-item destructive"
                onSelect={() => setDeleteId(chat.id)}
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
        <nav className="rail" aria-label="Workflows">
          <div className="wordmark" aria-label="Pavane">
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <path d="M9 25V7h8a6 6 0 0 1 0 12h-4" />
              <path d="M13 25V11h4a2 2 0 0 1 0 4h-4" />
            </svg>
          </div>
          <div className="rail-nav">
            {views.map(({ id, label, icon: Icon }) => (
              <Tip key={id} label={label}>
                <button
                  className={`rail-button ${view === id ? "active" : ""}`}
                  aria-label={label}
                  aria-current={view === id ? "page" : undefined}
                  onClick={() => navigate(id)}
                >
                  <Icon size={21} strokeWidth={1.6} />
                </button>
              </Tip>
            ))}
          </div>
          <Tip label="Connections & settings">
            <button
              className="rail-button rail-settings"
              aria-label="Connections and settings"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={20} strokeWidth={1.6} />
            </button>
          </Tip>
          <div className="profile" title="Local profile">
            D
          </div>
        </nav>
        {sidebar && (
          <aside className="sidebar" aria-label="Conversation sidebar">
            <div className="sidebar-heading">
              <span>
                Pavane<span className="alpha-tag">alpha</span>
              </span>
              <div className="inline-actions">
                <Tip label="Search chats · Ctrl+K">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Search chats"
                    onClick={() => setSearching((value) => !value)}
                  >
                    <Search size={17} />
                  </Button>
                </Tip>
                <Tip label="Hide sidebar">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Hide sidebar"
                    onClick={() => setSidebar(false)}
                  >
                    <PanelLeftClose size={17} />
                  </Button>
                </Tip>
              </div>
            </div>
            {searching && (
              <div className="sidebar-search">
                <Search size={15} />
                <input
                  autoFocus
                  placeholder="Search chat titles…"
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
                  }}
                >
                  <X size={14} />
                </Button>
              </div>
            )}
            <div className="sidebar-actions">
              <Button
                variant="primary"
                aria-label="New chat"
                onClick={() => {
                  if (!showChat) setView("chat");
                  void createChat();
                }}
                disabled={busy}
              >
                <Plus size={16} />
                New chat<kbd>Ctrl ⇧ O</kbd>
              </Button>
              <Tip label="Saved for 30 days, then removed from this device">
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (!showChat) setView("chat");
                    void createChat(true);
                  }}
                  disabled={busy}
                >
                  <Clock3 size={16} />
                  Delete Soon<small>30 days</small>
                </Button>
              </Tip>
            </div>
            <div className="sidebar-scroll">
              {workspace && (
                <button
                  className="workspace-back"
                  onClick={() => setWorkspaceId(null)}
                >
                  <ChevronLeft size={14} />
                  {viewInfo.label}
                </button>
              )}
              {view !== "chat" && !workspaceId && (
                <div className="sidebar-workspace-title">
                  <viewInfo.icon size={17} />
                  <span>{viewInfo.label}</span>
                </div>
              )}
              <div className="list-label">
                {workspace ? workspace.name : "Recent chats"}
                <span>{permanent.length || ""}</span>
              </div>
              {chatRows(permanent)}
              {permanent.length === 0 && (
                <p className="sidebar-empty">
                  {query
                    ? "No matching chats"
                    : "Your conversations start here."}
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
              {temporary.length > 0 && (
                <div className="temporary-list">
                  <div className="list-label">
                    <span>
                      <Clock3 size={12} />
                      Deleting soon
                    </span>
                    <span>{temporary.length}</span>
                  </div>
                  {chatRows(temporary)}
                </div>
              )}
            </div>
            <button className="device-status" onClick={() => setSettings(true)}>
              <span className="device-icon">
                <HardDrive size={16} />
              </span>
              <span>
                On this device
                <small>{native ? "Local storage" : "Interface preview"}</small>
              </span>
              <Settings2 size={15} />
            </button>
          </aside>
        )}
        <main className="main-pane">
          <header className="main-header">
            <div className="header-location">
              {!sidebar && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Show sidebar"
                  onClick={() => setSidebar(true)}
                >
                  <PanelLeftOpen size={17} />
                </Button>
              )}
              <span>
                {showChat ? (workspace?.name ?? "Chat") : viewInfo.label}
              </span>
              {showChat && (
                <>
                  <span className="breadcrumb-divider">/</span>
                  <span className="header-title">
                    {current?.title ?? "New chat"}
                  </span>
                </>
              )}
            </div>
            <div className="header-meta">
              {showChat && current?.expiresAt ? (
                <Tip
                  label={`Expires ${new Date(current.expiresAt).toLocaleString()}`}
                >
                  <span className="retention-tag">
                    <Clock3 size={13} />
                    {daysRemaining(current.expiresAt)} days left
                  </span>
                </Tip>
              ) : (
                <span className="local-tag">
                  <span />
                  {selectedModels.some((id) => id.startsWith("codex:"))
                    ? "Codex · cloud"
                    : "Local"}
                </span>
              )}
              <Tip label="Provider connections">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Provider connections"
                  onClick={() => setSettings(true)}
                >
                  <Settings2 size={17} />
                </Button>
              </Tip>
            </div>
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
                    <div className="suggestion-row">
                      {[
                        {
                          icon: Sparkles,
                          text: "Explore an idea",
                          prompt:
                            "Help me explore an idea. Ask me one question at a time.",
                        },
                        {
                          icon: Pencil,
                          text: "Write something",
                          prompt:
                            "Help me write something. Start by asking what I am working on.",
                        },
                        {
                          icon: Layers3,
                          text: "See another angle",
                          prompt:
                            "Help me look at a decision from different perspectives. Ask me about the decision first.",
                        },
                      ].map(({ icon: Icon, text, prompt }) => (
                        <button
                          key={text}
                          disabled={native && !currentId}
                          onClick={() => {
                            changeDraft(prompt);
                            composer.current?.focus();
                          }}
                        >
                          <Icon size={14} />
                          {text}
                        </button>
                      ))}
                    </div>
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
                      />
                    ))}
                  </div>
                )}
              </div>
              <div className="composer-region">
                {draftTooLong && (
                  <p className="composer-error" id="draft-limit" role="alert">
                    Message exceeds 64 KiB. Shorten it to save and send. Your
                    text is kept in this window.
                  </p>
                )}
                {current?.expiresAt && (
                  <div className="retention-notice">
                    <Clock3 size={13} />
                    <span>Saved for 30 days from creation.</span>
                    <button
                      onClick={() => {
                        void keepChat(current.id).catch(report);
                      }}
                    >
                      Keep this chat
                    </button>
                  </div>
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
                    aria-describedby={draftTooLong ? "draft-limit" : undefined}
                    onChange={(event) => changeDraft(event.target.value)}
                    disabled={loading || busy || (native && !currentId)}
                    maxLength={65536}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && running && currentId) {
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
                    <div className="inline-actions">
                      <Tip label="Attachments are planned">
                        <span tabIndex={0}>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Attachments are planned"
                            disabled
                          >
                            <Paperclip size={18} />
                          </Button>
                        </span>
                      </Tip>
                    </div>
                    <div className="composer-model">
                      <ModelPicker
                        models={models}
                        preferences={preferences}
                        update={updatePreferences}
                        open={pickerOpen}
                        onOpenChange={setPickerOpen}
                        connecting={connecting}
                        onRefresh={() => void connect()}
                        onConnect={() => setSettings(true)}
                        onSelected={() => focusComposer(currentId ?? undefined)}
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
                <div className="composer-footer">
                  <span>
                    {saving
                      ? "Saving draft…"
                      : currentId && draftCache.current.has(currentId)
                        ? "Draft not saved"
                        : native
                          ? "Saved on this device"
                          : "Desktop preview"}
                  </span>
                  <span>
                    Enter to send <span className="footer-dot">·</span> Shift +
                    Enter for a new line
                  </span>
                </div>
              </div>
            </>
          ) : ["projects", "spaces", "bots"].includes(view) ? (
            <div className="workspace-page">
              <div className="page-title-row">
                <div>
                  <p className="eyebrow">YOUR WORKSPACE</p>
                  <h1>{viewInfo.label}</h1>
                  <p>{descriptions[view as keyof typeof descriptions]}</p>
                </div>
                <Button
                  variant="primary"
                  onClick={() => setCreateKind(view as Workspace["kind"])}
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
                        <p>{item.instructions || "Open this workspace"}</p>
                        <span>
                          Open workspace <ArrowUp size={13} />
                        </span>
                      </button>
                    ))}
                </div>
              ) : (
                <div className="workspace-empty">
                  <viewInfo.icon size={42} strokeWidth={1} />
                  <h2>
                    {view === "bots"
                      ? "Make it your kind of assistant."
                      : "Give your ideas a home."}
                  </h2>
                  <p>
                    {view === "bots"
                      ? "Save instructions for the way you like to work."
                      : "Group conversations and give them shared instructions."}
                  </p>
                  <Button
                    onClick={() => setCreateKind(view as Workspace["kind"])}
                  >
                    <Plus size={15} />
                    Create your first{" "}
                    {view === "bots"
                      ? "bot"
                      : view === "spaces"
                        ? "space"
                        : "project"}
                  </Button>
                  <small>
                    {view === "spaces"
                      ? "Shared context is local. Collaboration comes later."
                      : view === "bots"
                        ? "Reusable instructions now. Tools and autonomous swarms come later."
                        : "Conversations and instructions now. Files and deeper context come later."}
                  </small>
                </div>
              )}
            </div>
          ) : (
            <div className="studio-empty">
              <div className="studio-icon">
                <viewInfo.icon size={34} strokeWidth={1.2} />
              </div>
              <span className="badge">Planned</span>
              <h1>
                {view === "images"
                  ? "A space for the visual."
                  : "Ideas, in motion."}
              </h1>
              <p>
                {view === "images"
                  ? "Image generation, editing, and a library of everything you make."
                  : "Video generation, variations, and your own creative library."}
              </p>
              <Button onClick={() => setRoadmap(true)}>
                See what’s next
                <ArrowDown size={14} />
              </Button>
            </div>
          )}
        </main>
        <Modal
          open={settings}
          onOpenChange={setSettings}
          title="Your connections"
          description="Bring your models into one workspace."
          wide
        >
          <Providers
            models={models}
            providers={providers}
            busy={connecting}
            onRefresh={() => void connect()}
            error={providerError}
          />
          <div className="settings-bottom">
            <HardDrive size={15} />
            <span>
              Chats stay in SQLite on this device. A selected provider receives
              the chat context when you send.
            </span>
          </div>
        </Modal>
        <Modal
          open={!!deleteId}
          onOpenChange={(open) => {
            if (!open) setDeleteId(null);
          }}
          title="Delete this chat?"
          description="This removes the conversation from this device. It cannot be undone."
        >
          <div className="dialog-actions">
            <Button onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!deleteId) return;
                void api
                  .delete(deleteId)
                  .then(async () => {
                    if (currentRef.current === deleteId) {
                      ++selection.current;
                      currentRef.current = null;
                      setCurrentId(null);
                      setMessages([]);
                      setDraft("");
                      setLoading(true);
                      const replacement = await api.createChat(
                        false,
                        workspaceId,
                      );
                      await openChat(replacement);
                    }
                    setDeleteId(null);
                    await refresh();
                  })
                  .catch(report);
              }}
            >
              <Trash2 size={15} />
              Delete chat
            </Button>
          </div>
        </Modal>
        <Modal
          open={!!renameId}
          onOpenChange={(open) => {
            if (!open) setRenameId(null);
          }}
          title="Rename chat"
          description="Give this conversation a title you can find again."
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!renameId) return;
              void api
                .rename(renameId, renameTitle)
                .then(async () => {
                  setSelectedChat((previous) =>
                    previous?.id === renameId
                      ? { ...previous, title: renameTitle.trim() }
                      : previous,
                  );
                  setChats((previous) =>
                    previous.map((chat) =>
                      chat.id === renameId
                        ? { ...chat, title: renameTitle.trim() }
                        : chat,
                    ),
                  );
                  setRenameId(null);
                  await refresh();
                })
                .catch(report);
            }}
          >
            <label className="field-label" htmlFor="chat-title">
              Title
            </label>
            <input
              className="text-input"
              id="chat-title"
              value={renameTitle}
              maxLength={120}
              onChange={(event) => setRenameTitle(event.target.value)}
              required
            />
            <div className="dialog-actions">
              <Button type="button" onClick={() => setRenameId(null)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit">
                Save title
              </Button>
            </div>
          </form>
        </Modal>
        <Modal
          open={!!createKind}
          onOpenChange={(open) => {
            if (!open) setCreateKind(null);
          }}
          title={`New ${createKind === "bots" ? "bot" : createKind === "spaces" ? "space" : "project"}`}
          description="A dedicated place for conversations and shared instructions."
        >
          <form onSubmit={(event) => void saveWorkspace(event)}>
            <label className="field-label" htmlFor="workspace-name">
              Name
            </label>
            <input
              className="text-input"
              id="workspace-name"
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
              placeholder="How should the assistant work here?"
              value={instructions}
              maxLength={8192}
              onChange={(event) => setInstructions(event.target.value)}
            />
            <div className="dialog-actions">
              <Button type="button" onClick={() => setCreateKind(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={busy || !workspaceName.trim()}
              >
                Create
              </Button>
            </div>
          </form>
        </Modal>
        <Modal
          open={roadmap}
          onOpenChange={setRoadmap}
          title="Built one workflow at a time"
          description="What works today, and what comes next."
        >
          <ol className="roadmap">
            <li>
              <Check size={17} />
              <div>
                <strong>Local chat foundation</strong>
                <p>
                  SQLite history, Delete Soon, reusable workspaces, and
                  local-model streaming.
                </p>
              </div>
            </li>
            <li>
              <Layers3 size={17} />
              <div>
                <strong>Provider subscriptions & orchestration</strong>
                <p>
                  Supported subscription bridges, provider-reported limits,
                  tools, and autonomous swarms. Parallel model comparison is
                  available now.
                </p>
              </div>
            </li>
            <li>
              <Image size={17} />
              <div>
                <strong>Images & video</strong>
                <p>
                  Generation adapters, media jobs, editing, and a local asset
                  library.
                </p>
              </div>
            </li>
          </ol>
        </Modal>
      </div>
    </TooltipProvider>
  );
}
