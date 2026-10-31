import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GeminiKeyForm } from "./gemini-key-form";

const api = vi.hoisted(() => ({
  saveGeminiKey: vi.fn(),
  removeGeminiKey: vi.fn(),
  openExternal: vi.fn(),
}));
vi.mock("../lib/api", () => ({ api }));
const changed = vi.fn();
const KEY = "synthetic-gemini-test-key";
beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(cleanup);

it("masks the key, rejects invalid input and saves only once while pending", async () => {
  let finish!: () => void;
  api.saveGeminiKey.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  render(<GeminiKeyForm onChanged={changed} />);
  const input = screen.getByLabelText("Gemini API key");
  const save = screen.getByRole("button", { name: "Save key" });
  expect(input).toHaveAttribute("type", "password");
  expect(input).toHaveAttribute("autocomplete", "off");
  expect(save).toBeDisabled();
  fireEvent.change(input, { target: { value: "invalid key" } });
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(save).toBeDisabled();
  fireEvent.change(input, { target: { value: KEY } });
  const form = input.closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(api.saveGeminiKey).toHaveBeenCalledTimes(1);
  expect(api.saveGeminiKey).toHaveBeenCalledWith(KEY);
  expect(input).toHaveAttribute("readonly");
  expect(form).toHaveAttribute("aria-busy", "true");
  await act(async () => finish());
  await screen.findByText("API key saved.");
  expect(input).toHaveValue("");
  expect(changed).toHaveBeenCalledTimes(1);
});

it("retains the masked value on failure without rendering a secret-bearing exception", async () => {
  api.saveGeminiKey
    .mockRejectedValueOnce(new Error(`synthetic failure ${KEY}`))
    .mockResolvedValueOnce(undefined);
  render(<GeminiKeyForm onChanged={changed} />);
  const input = screen.getByLabelText("Gemini API key");
  fireEvent.change(input, { target: { value: KEY } });
  fireEvent.click(screen.getByRole("button", { name: "Save key" }));
  await screen.findByText(/Could not save the API key/);
  expect(input).toHaveValue(KEY);
  expect(screen.queryByText(new RegExp(KEY))).not.toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save key" }));
  await screen.findByText("API key saved.");
  expect(input).toHaveValue("");
  expect(changed).toHaveBeenCalledTimes(1);
});

it("removes the native key without reading it and reports failed removal honestly", async () => {
  api.removeGeminiKey
    .mockRejectedValueOnce(new Error(KEY))
    .mockResolvedValueOnce(undefined);
  render(<GeminiKeyForm onChanged={changed} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
  await screen.findByText(/Could not remove the API key/);
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
  await screen.findByText("API key removed.");
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(api.removeGeminiKey).toHaveBeenNthCalledWith(1);
  expect(api.removeGeminiKey).toHaveBeenNthCalledWith(2);
  expect(api.saveGeminiKey).not.toHaveBeenCalled();
});

it("opens only the static provider key-setup URL without the entered key", async () => {
  api.openExternal.mockResolvedValue(undefined);
  render(<GeminiKeyForm onChanged={changed} />);
  fireEvent.change(screen.getByLabelText("Gemini API key"), {
    target: { value: KEY },
  });
  fireEvent.click(screen.getByRole("button", { name: "Get API key" }));
  expect(api.openExternal).toHaveBeenCalledWith(
    "https://aistudio.google.com/apikey",
  );
  expect(api.saveGeminiKey).not.toHaveBeenCalled();
});
