import { useEffect, useRef, useState } from "react";

/** Feedback describes the text actually copied, including during streaming. */
export function useCopyFeedback(
  value: string,
  onError?: (error: unknown) => void,
) {
  const [snapshot, setSnapshot] = useState<{ text: string } | null>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    if (!snapshot) return;
    const timer = window.setTimeout(() => setSnapshot(null), 1500);
    return () => window.clearTimeout(timer);
  }, [snapshot]);
  async function copy() {
    const request = ++generation.current;
    try {
      await navigator.clipboard.writeText(value);
      if (request === generation.current) setSnapshot({ text: value });
    } catch (error) {
      if (request === generation.current) {
        setSnapshot(null);
        onError?.(error);
      }
    }
  }
  return { copied: snapshot?.text === value, copy };
}
