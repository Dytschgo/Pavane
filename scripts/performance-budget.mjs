// Evaluate only recorded stages. An empty list does not imply that later
// stages ran: the fixture's result, phase and checks preserve that distinction.
export function observedBudgetViolations(result) {
  const { stream, reading, history, budgets } = result;
  const violations = [];
  if (stream && stream.typingP95Ms > budgets.typingP95Ms)
    violations.push("stream typing p95");
  if (stream && stream.typingMaxMs > budgets.typingMaxMs)
    violations.push("stream typing maximum");
  if (stream && stream.follow.gapPx > budgets.followGapPx)
    violations.push("stream auto-follow");
  if (
    reading &&
    (!reading.sameText ||
      reading.addedHeightPx <= 0 ||
      reading.anchorShiftPx > budgets.historyAnchorShiftPx)
  )
    violations.push("manual reading position during streaming");
  if (reading && reading.resumedGapPx > budgets.followGapPx)
    violations.push("stream follow after returning to latest");
  if (reading && reading.growthAfterResumePx <= 0)
    violations.push("no content growth after resuming follow");
  if (
    history &&
    (!history.sameText || history.anchorShiftPx > budgets.historyAnchorShiftPx)
  )
    violations.push("history reading anchor");
  return violations;
}
