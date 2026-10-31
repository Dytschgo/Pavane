import { useCallback, useState } from "react";
import type { ModelOptions } from "./types";

export function effortLabel(effort: string) {
  return effort === "xhigh"
    ? "Extra High"
    : effort.charAt(0).toUpperCase() + effort.slice(1);
}

export interface Preferences {
  selected: string[];
  favourites: string[];
  options: Record<string, ModelOptions>;
  compare: boolean;
}
const empty: Preferences = {
  selected: [],
  favourites: [],
  options: {},
  compare: false,
};
const key = "pavane.models.v1";
function ids(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter(
          (item): item is string =>
            typeof item === "string" && item.length < 256,
        )
        .slice(0, 32)
    : [];
}
export function readPreferences(): Preferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!value || typeof value !== "object") return empty;
    const data = value as Record<string, unknown>;
    const options: Record<string, ModelOptions> = {};
    if (data.options && typeof data.options === "object")
      for (const [id, value] of Object.entries(data.options).slice(0, 64)) {
        if (!value || typeof value !== "object" || id.length > 256) continue;
        const item = value as Record<string, unknown>;
        options[id] = {
          reasoningEffort:
            typeof item.reasoningEffort === "string" &&
            item.reasoningEffort.length < 32
              ? item.reasoningEffort
              : null,
          serviceTier:
            typeof item.serviceTier === "string" && item.serviceTier.length < 32
              ? item.serviceTier
              : null,
        };
      }
    return {
      selected: ids(data.selected).slice(0, data.compare === true ? 4 : 1),
      favourites: ids(data.favourites),
      options,
      compare: data.compare === true,
    };
  } catch {
    return empty;
  }
}

export function useModelPreferences() {
  const [preferences, setState] = useState(readPreferences);
  const update = useCallback(
    (action: (previous: Preferences) => Preferences) => {
      setState((previous) => {
        const next = action(previous);
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* Selection still works if browser preference storage is unavailable. */
        }
        return next;
      });
    },
    [],
  );
  return { preferences, update };
}
