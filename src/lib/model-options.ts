import type { Model, ModelOptions } from "./types";

/** Use the same capability fallback for display and submission. */
export function resolveModelOptions(
  model: Model,
  saved?: ModelOptions,
): ModelOptions {
  return {
    reasoningEffort:
      saved?.reasoningEffort &&
      model.reasoningEfforts?.includes(saved.reasoningEffort)
        ? saved.reasoningEffort
        : (model.defaultReasoningEffort ?? null),
    serviceTier:
      saved?.serviceTier &&
      (saved.serviceTier === "default" ||
        model.serviceTiers?.some((tier) => tier.id === saved.serviceTier))
        ? saved.serviceTier
        : "default",
  };
}
