import { describe, expect, it } from "vitest";
import { applyRunEvent, daysRemaining } from "./types";
import type { Message, RunEvent } from "./types";

describe("run event isolation", () => {
  it("updates only the matching message when parallel responses interleave", () => {
    const messages: Message[] = ["a", "b"].map((id) => ({
      id,
      chatId: "chat",
      role: "assistant",
      content: "",
      model: "local",
      status: "pending",
      createdAt: 0,
      sequence: 1,
    }));
    const event: RunEvent = {
      runId: "run",
      chatId: "chat",
      messageId: "b",
      kind: "delta",
      delta: "hello",
      status: "running",
      error: null,
    };
    const updated = applyRunEvent(messages, event);
    expect(updated[0]).toBe(messages[0]);
    expect(updated[1].content).toBe("hello");
    expect(
      applyRunEvent(updated, {
        ...event,
        kind: "finished",
        delta: " world",
        status: "complete",
      })[1],
    ).toMatchObject({ content: "hello world", status: "complete" });
  });
  it("rounds up remaining retention days without displaying negative days", () => {
    expect(daysRemaining(30 * 86_400_000, 0)).toBe(30);
    expect(daysRemaining(1, 0)).toBe(1);
    expect(daysRemaining(0, 1)).toBe(0);
  });
});
