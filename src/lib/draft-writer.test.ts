import { expect, it, vi } from "vitest";
import { DraftWriter } from "./draft-writer";

it("flushes an edit arriving after the last acknowledgement but before idle", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const busy = vi.fn();
  const writer = new DraftWriter(
    save,
    ({ version }) => {
      if (version === 1)
        queueMicrotask(() =>
          writer.enqueue({ chatId: "a", content: "newer", version: 2 }),
        );
    },
    () => {},
    busy,
  );
  writer.enqueue({ chatId: "a", content: "first", version: 1 });
  await writer.flush();
  expect(save.mock.calls).toEqual([
    ["a", "first"],
    ["a", "newer"],
  ]);
  expect(busy).toHaveBeenLastCalledWith(false);
});

it("keeps the latest snapshot for each chat and continues after a failed save", async () => {
  let reject: (error: Error) => void = () => {};
  const save = vi
    .fn()
    .mockResolvedValue(undefined)
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
  const saved = vi.fn();
  const failed = vi.fn();
  const writer = new DraftWriter(save, saved, failed, () => {});
  writer.enqueue({ chatId: "a", content: "old", version: 1 });
  writer.enqueue({ chatId: "b", content: "other chat", version: 2 });
  writer.enqueue({ chatId: "a", content: "obsolete", version: 3 });
  writer.enqueue({ chatId: "a", content: "latest", version: 4 });
  reject(new Error("Synthetic disk failure"));
  await writer.flush();
  expect(save.mock.calls).toEqual([
    ["a", "old"],
    ["b", "other chat"],
    ["a", "latest"],
  ]);
  expect(failed).toHaveBeenCalledTimes(1);
  expect(saved.mock.calls.map(([snapshot]) => snapshot.version)).toEqual([
    2, 4,
  ]);
});
