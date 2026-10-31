import * as Popover from "@radix-ui/react-popover";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Cpu,
  Globe2,
  Layers3,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Zap,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Model } from "../lib/types";
import { effortLabel } from "../lib/model-preferences";
import type { Preferences } from "../lib/model-preferences";
import { resolveModelOptions } from "../lib/model-options";
import { Button } from "./ui/button";
import { Tip } from "./ui/tooltip";
import { providerPresentation } from "../lib/provider-presentation";

interface Props {
  models: Model[];
  preferences: Preferences;
  update: (action: (previous: Preferences) => Preferences) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connecting: boolean;
  onRefresh: () => void;
  onConnect: () => void;
  onSelected?: () => void;
}
export function ModelPicker({
  models,
  preferences,
  update,
  open,
  onOpenChange,
  connecting,
  onRefresh,
  onConnect,
  onSelected,
}: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [active, setActive] = useState<string | null>(
    preferences.selected[0] ?? null,
  );
  const [details, setDetails] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const keyboardDetails = useRef(false);
  const picked = useRef(false);
  const activeOption = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = models.find((model) => model.id === preferences.selected[0]);
  const resolved = selected
    ? resolveModelOptions(selected, preferences.options[selected.id])
    : null;
  const effort = resolved?.reasoningEffort;
  const tier = selected?.serviceTiers?.find(
    (tier) => tier.id === resolved?.serviceTier,
  );
  const modelName =
    selected?.name ??
    (connecting
      ? "Connecting models"
      : preferences.selected.length
        ? "Model unavailable"
        : "Choose model");
  const triggerLabel =
    preferences.selected.length > 1
      ? `${preferences.selected.length} models`
      : modelName;
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const visible = models.filter((model) => {
    const inProvider =
      filter === "all" ||
      (filter === "favourites" && preferences.favourites.includes(model.id)) ||
      model.provider.toLowerCase() === filter;
    const text =
      `${model.name} ${model.provider} ${model.id}`.toLocaleLowerCase();
    return inProvider && terms.every((term) => text.includes(term));
  });
  if (filter === "favourites")
    visible.sort(
      (a, b) =>
        preferences.favourites.indexOf(a.id) -
        preferences.favourites.indexOf(b.id),
    );
  const index = Math.max(
    0,
    visible.findIndex((model) => model.id === active),
  );
  const current = visible[index];
  useEffect(() => {
    if (open) activeOption.current?.scrollIntoView({ block: "nearest" });
  }, [open, current?.id, index]);
  const providerIds = [
    ...new Set(models.map((model) => model.provider.toLowerCase())),
  ];
  const rails = [
    { id: "all", label: "All models", icon: Globe2 },
    { id: "favourites", label: "Favourites", icon: Star },
    ...providerIds.map((id) => ({
      id,
      label: providerPresentation(id).label,
      icon: providerPresentation(id).icon,
    })),
  ];
  function favourite(id: string) {
    update((previous) => ({
      ...previous,
      favourites: previous.favourites.includes(id)
        ? previous.favourites.filter((item) => item !== id)
        : [...previous.favourites, id].slice(0, 32),
    }));
  }
  function finishSelection() {
    picked.current = true;
    setQuery("");
    setDetails(null);
    onOpenChange(false);
  }
  function choose(model: Model, single = false) {
    update((previous) => ({
      ...previous,
      compare: single ? false : previous.compare,
      selected:
        previous.compare && !single
          ? previous.selected.includes(model.id)
            ? previous.selected.filter((id) => id !== model.id)
            : [...previous.selected, model.id].slice(0, 4)
          : [model.id],
    }));
    if (!preferences.compare || single) finishSelection();
  }
  function setting(model: Model, effort?: string, tier?: string) {
    update((previous) => ({
      ...previous,
      selected: previous.compare
        ? [...new Set([...previous.selected, model.id])].slice(0, 4)
        : [model.id],
      options: {
        ...previous.options,
        [model.id]: resolveModelOptions(model, {
          ...resolveModelOptions(model, previous.options[model.id]),
          ...(effort ? { reasoningEffort: effort } : {}),
          ...(tier ? { serviceTier: tier } : {}),
        }),
      },
    }));
    setDetails(null);
    if (!preferences.compare) finishSelection();
  }
  const TriggerIcon = providerPresentation(selected?.provider ?? "Ollama").icon;
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        picked.current = false;
        onOpenChange(value);
        if (!value) {
          setQuery("");
          setDetails(null);
        }
      }}
    >
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          size="small"
          className="model-trigger"
          aria-label={`Model: ${triggerLabel}${effort && preferences.selected.length === 1 ? `, ${effortLabel(effort)}` : ""}${tier && preferences.selected.length === 1 ? `, ${tier.name}` : ""}. Change model`}
        >
          <TriggerIcon size={15} />
          <span>{triggerLabel}</span>
          {effort && preferences.selected.length === 1 && (
            <small>{effortLabel(effort)}</small>
          )}
          {tier && preferences.selected.length === 1 && (
            <small className="model-tier" title={tier.description || tier.name}>
              <Zap size={12} />
              {tier.name}
            </small>
          )}
          <ChevronDown size={12} />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="picker-shell"
          side="top"
          align="end"
          sideOffset={12}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            picked.current = false;
            setQuery("");
            setFilter("all");
            setActive(preferences.selected[0] ?? null);
            search.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (picked.current && onSelected) {
              event.preventDefault();
              onSelected();
            }
          }}
          onKeyDown={(event) => {
            if (
              !event.nativeEvent.isComposing &&
              (event.ctrlKey || event.metaKey) &&
              /^[1-9]$/.test(event.key)
            ) {
              const model = models.find(
                (model) =>
                  model.id === preferences.favourites[Number(event.key) - 1],
              );
              if (model) {
                event.preventDefault();
                event.stopPropagation();
                choose(model, true);
              }
            }
          }}
          onEscapeKeyDown={(event) => {
            if (details) {
              event.preventDefault();
              setDetails(null);
              search.current?.focus();
            }
          }}
        >
          <div className="picker-rail" aria-label="Filter providers">
            {rails.map(({ id, label, icon: Icon }) => (
              <Tip key={id} label={label}>
                <button
                  className={`picker-rail-button ${filter === id ? "active" : ""}`}
                  aria-label={label}
                  aria-pressed={filter === id}
                  onClick={() => {
                    setFilter(id);
                    setQuery("");
                    setActive(null);
                    search.current?.focus();
                  }}
                >
                  <Icon
                    size={18}
                    fill={
                      id === "favourites" && filter === id
                        ? "currentColor"
                        : "none"
                    }
                  />
                </button>
              </Tip>
            ))}
          </div>
          <div className="picker-main">
            <div className="picker-search">
              <Search size={16} />
              <input
                ref={search}
                role="combobox"
                aria-label="Search models"
                aria-expanded={open}
                aria-controls={listId}
                aria-activedescendant={
                  current ? `${listId}-${index}` : undefined
                }
                placeholder="Search models…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(null);
                  setDetails(null);
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const next = Math.max(
                      0,
                      Math.min(
                        visible.length - 1,
                        index + (event.key === "ArrowDown" ? 1 : -1),
                      ),
                    );
                    setActive(visible[next]?.id ?? null);
                    setDetails(null);
                  }
                  if (event.key === "Enter" && current) {
                    event.preventDefault();
                    choose(current);
                  }
                  if (
                    event.key === "ArrowRight" &&
                    !event.shiftKey &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    !event.altKey &&
                    event.currentTarget.selectionStart ===
                      event.currentTarget.value.length &&
                    event.currentTarget.selectionEnd ===
                      event.currentTarget.value.length &&
                    current &&
                    (current.reasoningEfforts?.length ||
                      current.serviceTiers?.length)
                  ) {
                    event.preventDefault();
                    keyboardDetails.current = true;
                    setDetails(current.id);
                  }
                  if (
                    (event.ctrlKey || event.metaKey) &&
                    event.key.toLowerCase() === "d" &&
                    current
                  ) {
                    event.preventDefault();
                    favourite(current.id);
                  }
                }}
              />
              <Tip label="Refresh models">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Refresh models"
                  disabled={connecting}
                  onClick={onRefresh}
                >
                  {connecting ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                </Button>
              </Tip>
            </div>
            <div
              className="picker-list"
              id={listId}
              role="listbox"
              aria-label="Available models"
              aria-multiselectable={preferences.compare}
            >
              {!visible.length && (
                <div className="picker-empty">
                  {connecting ? (
                    <>
                      <LoaderCircle className="spin" size={17} />
                      <p>Finding your models…</p>
                    </>
                  ) : filter === "favourites" && !query ? (
                    <>
                      <Star size={20} />
                      <p>Star a model to keep it here.</p>
                      <small>Ctrl+D adds the highlighted model.</small>
                    </>
                  ) : (
                    <>
                      <Cpu size={20} />
                      <p>
                        {models.length
                          ? "No matching models"
                          : "No models connected yet"}
                      </p>
                      {models.length ? (
                        <button
                          onClick={() => {
                            setQuery("");
                            setFilter("all");
                            setActive(preferences.selected[0] ?? null);
                            search.current?.focus();
                          }}
                        >
                          Clear filters
                        </button>
                      ) : (
                        <button onClick={onConnect}>Open connections</button>
                      )}
                    </>
                  )}
                </div>
              )}
              {visible.map((model, row) => {
                const Icon = providerPresentation(model.provider).icon;
                const chosen = preferences.selected.includes(model.id);
                const starred = preferences.favourites.includes(model.id);
                const options = resolveModelOptions(
                  model,
                  preferences.options[model.id],
                );
                const selectedEffort = options.reasoningEffort;
                const selectedTier = options.serviceTier;
                const shortcut = preferences.favourites.indexOf(model.id) + 1;
                return (
                  <Popover.Root
                    key={model.id}
                    open={details === model.id}
                    onOpenChange={(value) =>
                      setDetails(value ? model.id : null)
                    }
                  >
                    <Popover.Anchor asChild>
                      <div
                        className={`picker-row ${index === row ? "highlighted" : ""}`}
                        onPointerMove={() => setActive(model.id)}
                      >
                        <div
                          role="option"
                          ref={index === row ? activeOption : undefined}
                          tabIndex={-1}
                          aria-selected={chosen}
                          aria-keyshortcuts={
                            shortcut > 0 && shortcut < 10
                              ? `Control+${shortcut}`
                              : undefined
                          }
                          id={`${listId}-${row}`}
                          className="picker-option"
                          onClick={() => choose(model)}
                        >
                          <Icon size={17} />
                          <span>
                            <strong>{model.name}</strong>
                            <small>
                              {model.provider}
                              {selectedEffort
                                ? ` · ${effortLabel(selectedEffort)}`
                                : ""}
                            </small>
                          </span>
                          {shortcut > 0 && shortcut < 10 && (
                            <kbd className="picker-shortcut" aria-hidden="true">
                              Ctrl+{shortcut}
                            </kbd>
                          )}
                          {chosen && <Check size={14} />}
                        </div>
                        <button
                          className={`favourite-toggle ${starred ? "is-favourite" : ""}`}
                          tabIndex={-1}
                          aria-label={`${starred ? "Unstar" : "Star"} ${model.name}`}
                          aria-pressed={starred}
                          onClick={() => favourite(model.id)}
                        >
                          <Star
                            size={13}
                            fill={starred ? "currentColor" : "none"}
                          />
                        </button>
                        {!!(
                          model.reasoningEfforts?.length ||
                          model.serviceTiers?.length
                        ) && (
                          <button
                            className="model-options-toggle"
                            aria-haspopup="dialog"
                            aria-expanded={details === model.id}
                            onClick={() => {
                              keyboardDetails.current = true;
                              setDetails(model.id);
                            }}
                            aria-label={`Options for ${model.name}`}
                            onPointerEnter={(event) => {
                              if (event.pointerType === "mouse") {
                                keyboardDetails.current = false;
                                setDetails(model.id);
                              }
                            }}
                          >
                            <ChevronRight size={14} />
                          </button>
                        )}
                      </div>
                    </Popover.Anchor>
                    <Popover.Portal>
                      <Popover.Content
                        className="model-details"
                        side="right"
                        align="start"
                        sideOffset={8}
                        onOpenAutoFocus={(event) => {
                          event.preventDefault();
                          if (keyboardDetails.current)
                            (event.target as HTMLElement)
                              .querySelector<HTMLButtonElement>(
                                '[role="radio"][aria-checked="true"]',
                              )
                              ?.focus();
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowLeft") {
                            event.preventDefault();
                            setDetails(null);
                            search.current?.focus();
                          }
                          if (
                            event.key === "ArrowDown" ||
                            event.key === "ArrowUp"
                          ) {
                            event.preventDefault();
                            const buttons = Array.from(
                              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                                '[role="radio"]',
                              ),
                            );
                            const index = buttons.indexOf(
                              document.activeElement as HTMLButtonElement,
                            );
                            buttons[
                              (index +
                                (event.key === "ArrowDown" ? 1 : -1) +
                                buttons.length) %
                                buttons.length
                            ]?.focus();
                          }
                        }}
                        onCloseAutoFocus={(event) => {
                          event.preventDefault();
                          search.current?.focus();
                        }}
                      >
                        {!!model.reasoningEfforts?.length && (
                          <>
                            <p className="detail-label">Reasoning</p>
                            <div
                              role="radiogroup"
                              aria-label={`Reasoning for ${model.name}`}
                            >
                              {model.reasoningEfforts.map((value) => (
                                <button
                                  key={value}
                                  className="detail-choice"
                                  role="radio"
                                  aria-checked={selectedEffort === value}
                                  onClick={() => setting(model, value)}
                                >
                                  <span>{effortLabel(value)}</span>
                                  {value === model.defaultReasoningEffort && (
                                    <small>Default</small>
                                  )}
                                  {selectedEffort === value && (
                                    <Check size={13} />
                                  )}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                        {!!model.serviceTiers?.length && (
                          <>
                            <div className="menu-separator" />
                            <p className="detail-label">Service tier</p>
                            <div
                              role="radiogroup"
                              aria-label={`Service tier for ${model.name}`}
                            >
                              <button
                                className="detail-choice"
                                role="radio"
                                aria-checked={selectedTier === "default"}
                                onClick={() =>
                                  setting(model, undefined, "default")
                                }
                              >
                                <span>Standard</span>
                                <small>Default</small>
                                {selectedTier === "default" && (
                                  <Check size={13} />
                                )}
                              </button>
                              {model.serviceTiers.map((tier) => (
                                <button
                                  key={tier.id}
                                  className="detail-choice has-description"
                                  role="radio"
                                  aria-checked={selectedTier === tier.id}
                                  onClick={() =>
                                    setting(model, undefined, tier.id)
                                  }
                                >
                                  <span>
                                    {tier.name}
                                    <small>{tier.description}</small>
                                  </span>
                                  {selectedTier === tier.id && (
                                    <Check size={13} />
                                  )}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                        <div className="model-safety">
                          <ShieldCheck size={13} />
                          <span>Text chat · read-only</span>
                        </div>
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                );
              })}
            </div>
            <div className="picker-bottom">
              <button
                className="picker-compare"
                aria-pressed={preferences.compare}
                onClick={() =>
                  update((previous) => ({
                    ...previous,
                    compare: !previous.compare,
                    selected: previous.compare
                      ? previous.selected.slice(0, 1)
                      : previous.selected,
                  }))
                }
              >
                <Layers3 size={15} />
                <span>
                  Compare models<small>Up to 4 parallel responses</small>
                </span>
                <span className={`switch ${preferences.compare ? "on" : ""}`} />
              </button>
              <button
                className="picker-connect"
                onClick={() => {
                  onOpenChange(false);
                  onConnect();
                }}
              >
                <Plus size={15} />
                Connections
              </button>
            </div>
            <div className="sr-only" aria-live="polite">
              {visible.length} models. {current?.name}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
