import type { ClipboardEvent } from "react";

// Only replace a whole field. Partial edits keep native selection semantics.
export function pasteWholeKey(
  event: ClipboardEvent<HTMLInputElement>,
  apply: (key: string) => void,
) {
  const input = event.currentTarget;
  if (
    input.readOnly ||
    input.selectionStart !== 0 ||
    input.selectionEnd !== input.value.length
  )
    return;
  const text = event.clipboardData.getData("text");
  const key = text.trim();
  if (!text || key === text || key.length > 2048) return;
  event.preventDefault();
  apply(key);
}
