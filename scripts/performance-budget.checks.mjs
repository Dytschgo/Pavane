import assert from "node:assert/strict";
import { test } from "node:test";
import { observedBudgetViolations } from "./performance-budget.mjs";

const budgets = {
  typingP95Ms: 120,
  typingMaxMs: 500,
  historyAnchorShiftPx: 3,
  followGapPx: 24,
};
const stream = (typingP95Ms = 120) => ({
  typingP95Ms,
  typingMaxMs: 500,
  follow: { gapPx: 24 },
});

test("a later profiler failure retains the already measured typing violation", () => {
  const result = {
    result: "failed",
    phase: "cpu-profile-stop",
    error: "CPU profile: invalid sample interval",
    budgets,
    stream: stream(128.2835),
    reading: {
      sameText: true,
      addedHeightPx: 15473,
      anchorShiftPx: 0,
      resumedGapPx: 0,
      growthAfterResumePx: 83209,
    },
  };
  const before = structuredClone(result);
  assert.deepEqual(observedBudgetViolations(result), ["stream typing p95"]);
  assert.deepEqual(result, before);
  assert.equal(result.history, undefined);
});

test("unchanged exact budgets pass; every measured failure remains visible", () => {
  assert.deepEqual(observedBudgetViolations({ budgets, stream: stream() }), []);
  assert.deepEqual(
    observedBudgetViolations({
      budgets,
      stream: { typingP95Ms: 120.001, typingMaxMs: 501, follow: { gapPx: 25 } },
      reading: {
        sameText: false,
        addedHeightPx: 0,
        anchorShiftPx: 4,
        resumedGapPx: 25,
        growthAfterResumePx: 0,
      },
      history: { sameText: false, anchorShiftPx: 4 },
    }),
    [
      "stream typing p95",
      "stream typing maximum",
      "stream auto-follow",
      "manual reading position during streaming",
      "stream follow after returning to latest",
      "no content growth after resuming follow",
      "history reading anchor",
    ],
  );
});

test("unreached stages are not invented or marked as passed", () => {
  const result = { budgets, result: "failed", phase: "startup" };
  assert.deepEqual(observedBudgetViolations(result), []);
  assert.equal(result.result, "failed");
  assert.deepEqual(Object.keys(result).sort(), ["budgets", "phase", "result"]);
});
