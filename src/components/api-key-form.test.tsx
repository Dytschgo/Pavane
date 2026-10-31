import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiKeyForm } from "./api-key-form";

const api = vi.hoisted(() => ({
  saveXaiKey: vi.fn(),
  removeXaiKey: vi.fn(),
  openExternal: vi.fn(),
  saveGeminiKey: vi.fn(),
  removeGeminiKey: vi.fn(),
}));
vi.mock("../lib/api", () => ({ api }));
const changed = vi.fn();
const KEY = "synthetic-xai-test-key";
beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(cleanup);

it("masks the key, rejects invalid input and saves only once while pending", async () => {
  let finish!: () => void;
  api.saveXaiKey.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  render(<ApiKeyForm provider="xai" onChanged={changed} />);
  const input = screen.getByLabelText("xAI API key");
  const save = screen.getByRole("button", { name: "Save xAI key" });
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
  expect(api.saveXaiKey).toHaveBeenCalledTimes(1);
  expect(api.saveXaiKey).toHaveBeenCalledWith(KEY);
  expect(input).toHaveAttribute("readonly");
  expect(form).toHaveAttribute("aria-busy", "true");
  await act(async () => finish());
  await screen.findByText("xAI API key saved.");
  expect(input).toHaveValue("");
  expect(changed).toHaveBeenCalledTimes(1);
});

it("retains the masked value on failure without rendering a secret-bearing exception", async () => {
  api.saveXaiKey
    .mockRejectedValueOnce(new Error(`synthetic failure ${KEY}`))
    .mockResolvedValueOnce(undefined);
  render(<ApiKeyForm provider="xai" onChanged={changed} />);
  const input = screen.getByLabelText("xAI API key");
  fireEvent.change(input, { target: { value: KEY } });
  fireEvent.click(screen.getByRole("button", { name: "Save xAI key" }));
  await screen.findByText(/Could not save the xAI API key/);
  expect(input).toHaveValue(KEY);
  expect(screen.queryByText(new RegExp(KEY))).not.toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save xAI key" }));
  await screen.findByText("xAI API key saved.");
  expect(input).toHaveValue("");
  expect(changed).toHaveBeenCalledTimes(1);
});

it("removes the native key without reading it and reports failed removal honestly", async () => {
  api.removeXaiKey
    .mockRejectedValueOnce(new Error(KEY))
    .mockResolvedValueOnce(undefined);
  render(<ApiKeyForm provider="xai" onChanged={changed} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove xAI key" }));
  await screen.findByText(/Could not remove the xAI API key/);
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Remove xAI key" }));
  await screen.findByText("xAI API key removed.");
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(api.removeXaiKey).toHaveBeenNthCalledWith(1);
  expect(api.removeXaiKey).toHaveBeenNthCalledWith(2);
  expect(api.saveXaiKey).not.toHaveBeenCalled();
});

it("opens only the static provider key-setup URL without the entered key", async () => {
  api.openExternal.mockResolvedValue(undefined);
  render(<ApiKeyForm provider="xai" onChanged={changed} />);
  fireEvent.change(screen.getByLabelText("xAI API key"), {
    target: { value: KEY },
  });
  fireEvent.click(screen.getByRole("button", { name: "Get xAI API key" }));
  expect(api.openExternal).toHaveBeenCalledWith(
    "https://console.x.ai/team/default/api-keys",
  );
  expect(api.saveXaiKey).not.toHaveBeenCalled();
});

it.each(["é-key", "key\tvalue", "x".repeat(2049)])(
  "rejects non-ASCII/control/oversized keys without native writes",
  (value) => {
    render(<ApiKeyForm provider="xai" onChanged={changed} />);
    const input = screen.getByLabelText("xAI API key");
    fireEvent.change(input, { target: { value } });
    fireEvent.submit(input.closest("form")!);
    expect(api.saveXaiKey).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  },
);

it("changes only the selected provider while both key forms are present", async () => {
  api.removeXaiKey.mockResolvedValue(undefined);
  const geminiChanged = vi.fn();
  render(
    <>
      <ApiKeyForm provider="gemini" onChanged={geminiChanged} />
      <ApiKeyForm provider="xai" onChanged={changed} />
    </>,
  );
  const gemini = screen.getByLabelText("Gemini API key");
  const xai = screen.getByLabelText("xAI API key");
  fireEvent.change(gemini, { target: { value: "synthetic-gemini-draft" } });
  fireEvent.change(xai, { target: { value: KEY } });
  fireEvent.click(screen.getByRole("button", { name: "Remove xAI key" }));
  await screen.findByText("xAI API key removed.");
  expect(gemini).toHaveValue("synthetic-gemini-draft");
  expect(xai).toHaveValue("");
  expect(api.removeXaiKey).toHaveBeenCalledTimes(1);
  expect(api.removeGeminiKey).not.toHaveBeenCalled();
  expect(api.saveGeminiKey).not.toHaveBeenCalled();
  expect(geminiChanged).not.toHaveBeenCalled();
  expect(changed).toHaveBeenCalledTimes(1);
});
