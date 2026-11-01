import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Modal } from "./modal";

afterEach(cleanup);

it("keeps composing input on IME Escape while ordinary Escape dismisses", () => {
  const change = vi.fn();
  render(
    <Modal
      open
      onOpenChange={change}
      title="Connection"
      description="Set up a connection"
    >
      <input aria-label="Connection name" defaultValue="Unfinished input" />
    </Modal>,
  );
  const input = screen.getByRole("textbox", { name: "Connection name" });
  fireEvent.keyDown(input, { key: "Escape", isComposing: true });
  expect(change).not.toHaveBeenCalled();
  expect(input).toHaveValue("Unfinished input");
  fireEvent.keyDown(input, { key: "Escape" });
  expect(change).toHaveBeenCalledWith(false);
});
