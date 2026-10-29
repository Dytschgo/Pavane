import { expect, it } from "vitest";
import type { Model } from "./types";
import { resolveModelOptions } from "./model-options";

const model: Model = {
  id: "codex:sol",
  name: "Sol",
  provider: "Codex",
  reasoningEfforts: ["low", "high"],
  defaultReasoningEffort: "low",
  serviceTiers: [
    { id: "priority", name: "Fast", description: "Provider tier" },
  ],
};
it("keeps supported preferences and falls back when provider capabilities change", () => {
  const saved = { reasoningEffort: "high", serviceTier: "priority" };
  expect(resolveModelOptions(model, saved)).toEqual(saved);
  expect(
    resolveModelOptions(
      { ...model, reasoningEfforts: ["low"], serviceTiers: [] },
      saved,
    ),
  ).toEqual({ reasoningEffort: "low", serviceTier: "default" });
});
it("does not carry reasoning or premium tiers into a model without those capabilities", () => {
  expect(
    resolveModelOptions(
      { id: "ollama:local", name: "Local", provider: "Ollama" },
      { reasoningEffort: "ultra", serviceTier: "priority" },
    ),
  ).toEqual({ reasoningEffort: null, serviceTier: "default" });
});
