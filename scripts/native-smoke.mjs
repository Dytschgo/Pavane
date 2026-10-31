import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer as createPortProbe } from "node:net";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { chromium } from "playwright-core";
import { verificationContext } from "./verification-context.mjs";
import { randomUUID } from "node:crypto";

// Drives the actual Windows WebView, never a browser storage imitation.
// Run only with no Ollama service on 11434; a bind error leaves it untouched.
const root = resolve(import.meta.dirname, "..");
const prebuilt = process.env.PAVANE_PREBUILT_VERIFICATION === "1";
const executable = join(
  root,
  prebuilt ? "verification-input/pavane.exe" : "target/debug/pavane.exe",
);
const context = await verificationContext(
  root,
  executable,
  prebuilt ? "release" : "debug",
);
const data = await mkdtemp(join(tmpdir(), "pavane-smoke-"));
const profile = prebuilt ? `verify-native-${randomUUID()}` : null;
const databaseDirectory = profile
  ? join(process.env.LOCALAPPDATA, "cloud.pavane.desktop", "profiles", profile)
  : data;
const evidence = process.env.PAVANE_EVIDENCE_DIR ?? join(root, "evidence");
await mkdir(evidence, { recursive: true });
await writeFile(
  join(evidence, "native-smoke.json"),
  JSON.stringify({ context, result: "running", checks: [] }, null, 2),
);
const requests = [];
const selectiveStreams = new Map();
let selectiveStopEvidence = null;
const mock = createServer(async (request, response) => {
  if (request.url === "/api/tags") {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({ models: [{ name: "smoke-a" }, { name: "smoke-b" }] }),
    );
    return;
  }
  if (request.url !== "/api/chat") {
    response.writeHead(404).end();
    return;
  }
  let body = "";
  for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body);
  requests.push(payload);
  response.setHeader("content-type", "application/x-ndjson");
  const last = payload.messages.at(-1).content;
  const streamState = { produced: 0, closed: false };
  if (
    last === "STOP_TEST one-response" &&
    ["smoke-a", "smoke-b"].includes(payload.model)
  )
    selectiveStreams.set(payload.model, streamState);
  if (last.includes("FAIL_TEST")) {
    response.end('{"error":"synthetic failure"}\n');
    return;
  }
  const chunks = last.includes("STOP_TEST")
    ? Array(300).fill("still thinking ")
    : ["Grüezi 🦀. ", "A persisted response ", `from ${payload.model}.`];
  let index = 0;
  const timer = setInterval(() => {
    if (index < chunks.length) {
      streamState.produced++;
      response.write(
        JSON.stringify({ message: { content: chunks[index++] }, done: false }) +
          "\n",
      );
    } else {
      clearInterval(timer);
      response.end('{"done":true}\n');
    }
  }, 90);
  response.on("close", () => {
    streamState.closed = true;
    clearInterval(timer);
  });
});
await new Promise((resolve, reject) => {
  mock.once("error", reject);
  mock.listen(11434, "127.0.0.1", resolve);
});

let child;
let browser;
const diagnostics = [];
async function requireFreePort() {
  const probe = createPortProbe();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(9422, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
}
async function launch() {
  // Never attach to an already-running app or debugging endpoint.
  await requireFreePort();
  child = spawn(executable, profile ? ["--profile", profile] : [], {
    cwd: root,
    env: {
      ...process.env,
      PAVANE_DATA_DIR: data,
      WEBVIEW2_USER_DATA_FOLDER: join(data, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9422",
    },
    stdio: "ignore",
  });
  child.on("error", (error) => diagnostics.push(error.message));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9422");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  assert.ok(browser, "Native WebView did not expose CDP");
  const page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (error) => diagnostics.push(error.message));
  await page.waitForFunction(() => {
    const prompt = document.querySelector("#prompt");
    return prompt && !prompt.disabled;
  });
  await access(join(databaseDirectory, "pavane.sqlite3"));
  if (prebuilt) assert.equal(new URL(page.url()).hostname, "tauri.localhost");
  return page;
}
async function close() {
  if (browser) {
    await browser.close();
    browser = undefined;
  }
  if (!child) return;
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      await requireFreePort();
      break;
    } catch (error) {
      if (error.code !== "EADDRINUSE" || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  child = undefined;
}
const checks = [];
try {
  let page = await launch();
  await page.screenshot({ path: join(evidence, "native-empty.png") });
  await page.getByRole("button", { name: /Change model/ }).click();
  await page
    .getByRole("option", { name: /smoke-a/ })
    .waitFor({ timeout: 45000 });
  await page.getByRole("option", { name: /smoke-a/ }).click();
  await page.getByRole("button", { name: "Delete Soon", exact: false }).click();
  await page.getByText("30 days left").waitFor();
  const oversized = "界".repeat(30000);
  const editor = page.getByRole("textbox", { name: "Message", exact: true });
  await editor.fill(oversized);
  await page.getByText(/Shorten it to save and send/).waitFor();
  assert.equal(await editor.inputValue(), oversized);
  assert.equal(
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .isDisabled(),
    true,
  );
  await editor.press("Enter");
  assert.equal(requests.length, 0);
  await page.screenshot({
    animations: "disabled",
    path: join(evidence, "native-unicode-limit.png"),
  });
  checks.push(
    "oversized Unicode draft remains intact with byte-limit feedback and cannot be sent",
  );
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Hello from the native smoke test");
  await page
    .getByText(/Shorten it to save and send/)
    .waitFor({ state: "hidden" });
  await page.screenshot({
    animations: "disabled",
    path: join(evidence, "native-composer-focused.png"),
  });
  const composerLayout = await page.evaluate(() => {
    const editor = document
      .querySelector(".composer textarea")
      .getBoundingClientRect();
    const toolbar = document
      .querySelector(".composer-toolbar")
      .getBoundingClientRect();
    const shell = document.querySelector(".composer").getBoundingClientRect();
    return {
      separated: editor.bottom <= toolbar.top,
      toolbarInside: toolbar.bottom <= shell.bottom,
      noPageOverflow: document.documentElement.scrollWidth <= innerWidth,
    };
  });
  assert.deepEqual(composerLayout, {
    separated: true,
    toolbarInside: true,
    noPageOverflow: true,
  });
  const beforePicker = requests.length;
  await page.getByRole("button", { name: /Change model/ }).click();
  await page.getByRole("combobox", { name: "Search models" }).waitFor();
  assert.equal(
    requests.length,
    beforePicker,
    "Choosing a model must not submit the draft",
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .inputValue(),
    "Hello from the native smoke test",
  );
  checks.push(
    "focused composer has separate input/toolbar, and model selection preserves the unsent draft",
  );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByText("Grüezi 🦀. A persisted response from smoke-a.", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Stop responses" })
    .waitFor({ state: "hidden" });
  checks.push(
    "native IPC, model discovery, UTF-8 streaming, persisted response, Delete Soon",
  );
  await page.screenshot({ path: join(evidence, "native-chat.png") });
  const reuse = page.getByRole("button", {
    name: "Add prompt to draft",
    exact: true,
  });
  const reuseRequests = requests.length;
  await reuse.focus();
  await page.keyboard.press("Enter");
  assert.equal(await editor.inputValue(), "Hello from the native smoke test");
  assert.equal(
    await editor.evaluate((element) => element === document.activeElement),
    true,
  );
  await editor.fill("My unsent note 🦀");
  await reuse.click();
  const reusedDraft = "My unsent note 🦀\n\nHello from the native smoke test";
  assert.equal(await editor.inputValue(), reusedDraft);
  await page.getByText("Saved on this device", { exact: true }).waitFor();
  await page.reload();
  await editor.waitFor();
  await page.waitForFunction(
    (expected) => document.querySelector("#prompt")?.value === expected,
    reusedDraft,
  );
  assert.equal(
    requests.length,
    reuseRequests,
    "Reusing a prompt must never submit it",
  );
  const reuseViewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
  await page.setViewportSize({ width: 720, height: 620 });
  await reuse.focus();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: join(evidence, "native-prompt-reuse.png") });
  await page.setViewportSize(reuseViewport);
  await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  const fullDraft = "界".repeat(21840);
  await editor.fill(fullDraft);
  await reuse.click();
  await page
    .getByText(
      "This prompt would exceed the 64 KiB draft limit. Shorten your draft first.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await editor.inputValue(), fullDraft);
  assert.equal(requests.length, reuseRequests);
  await page
    .getByRole("button", { name: "Dismiss error", exact: true })
    .click();
  await editor.fill("");
  await page.getByText("Saved on this device", { exact: true }).waitFor();
  checks.push(
    "keyboard prompt reuse appends without overwriting or sending, survives SQLite reload, and rejects UTF-8 overflow without losing the draft",
  );
  await page.getByRole("button", { name: /Change model/ }).click();
  await page.getByRole("button", { name: /Compare models/ }).click();
  await page.getByRole("option", { name: /smoke-b/ }).click();
  await page.keyboard.press("Escape");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Two perspectives");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByText("Grüezi 🦀. A persisted response from smoke-b.", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Stop responses" })
    .waitFor({ state: "hidden" });
  assert.equal(requests.length, 3);
  checks.push("two concurrent responses with isolated model output");
  selectiveStopEvidence = { phase: "starting", restored: false };
  await editor.fill("STOP_TEST one-response");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const selectedReply = page
    .getByRole("article", { name: "Response from smoke-a", exact: true })
    .last();
  const siblingReply = page
    .getByRole("article", { name: "Response from smoke-b", exact: true })
    .last();
  await selectedReply.getByText("still thinking", { exact: false }).waitFor();
  await siblingReply.getByText("still thinking", { exact: false }).waitFor();
  const selectiveDraft = "My draft stays while the other response continues.";
  await editor.fill(selectiveDraft);
  await selectedReply
    .getByRole("button", { name: "Stop this response", exact: true })
    .click();
  await selectedReply
    .getByText("Stopped. Partial text was saved.", { exact: true })
    .waitFor();
  const selectedText = await selectedReply
    .locator(".message-content")
    .innerText();
  const siblingTextLength = (
    await siblingReply.locator(".message-content").innerText()
  ).length;
  const siblingProduced = selectiveStreams.get("smoke-b").produced;
  Object.assign(selectiveStopEvidence, {
    phase: "selected-stopped",
    selectedBytes: Buffer.byteLength(selectedText),
    siblingProducedAtStop: siblingProduced,
  });
  await page.waitForFunction((previous) => {
    const replies = document.querySelectorAll(
      'article[aria-label="Response from smoke-b"] .message-content',
    );
    return (
      (replies[replies.length - 1]?.textContent?.length ?? 0) >
      previous + 3 * "still thinking ".length
    );
  }, siblingTextLength);
  const siblingProducedAfterGrowth = selectiveStreams.get("smoke-b").produced;
  Object.assign(selectiveStopEvidence, {
    phase: "sibling-growth-observed",
    siblingProducedAfterGrowth,
  });
  assert.ok(siblingProducedAfterGrowth > siblingProduced);
  assert.equal(selectiveStreams.get("smoke-b").closed, false);
  assert.equal(
    await selectedReply.locator(".message-content").innerText(),
    selectedText,
  );
  assert.equal(await editor.inputValue(), selectiveDraft);
  await page
    .getByRole("button", { name: "Stop responses", exact: true })
    .waitFor();
  const selectiveViewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
  await page.setViewportSize({ width: 720, height: 620 });
  await siblingReply
    .getByRole("button", { name: "Stop this response", exact: true })
    .focus();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: join(evidence, "native-response-stop.png") });
  await page.setViewportSize(selectiveViewport);
  await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  await page.getByText("Saved on this device", { exact: true }).waitFor();
  await page.reload();
  await siblingReply
    .getByRole("button", { name: "Stop this response", exact: true })
    .waitFor();
  selectiveStopEvidence.phase = "active-sibling-restored";
  await selectedReply.locator(".markdown").waitFor();
  assert.equal(await editor.inputValue(), selectiveDraft);
  assert.equal(
    await selectedReply.locator(".message-content").innerText(),
    selectedText,
  );
  await siblingReply
    .getByRole("button", { name: "Stop this response", exact: true })
    .click();
  await siblingReply
    .getByText("Stopped. Partial text was saved.", { exact: true })
    .waitFor();
  await selectedReply.locator(".markdown").waitFor();
  await siblingReply.locator(".markdown").waitFor();
  await page
    .getByRole("button", { name: "Stop responses", exact: true })
    .waitFor({ state: "hidden" });
  const siblingText = await siblingReply
    .locator(".message-content")
    .innerText();
  Object.assign(selectiveStopEvidence, {
    phase: "sibling-stopped",
    siblingBytes: Buffer.byteLength(siblingText),
  });
  await page.reload();
  await siblingReply
    .getByText("Stopped. Partial text was saved.", { exact: true })
    .waitFor();
  await selectedReply.locator(".markdown").waitFor();
  await siblingReply.locator(".markdown").waitFor();
  assert.equal(
    await selectedReply.locator(".message-content").innerText(),
    selectedText,
  );
  assert.equal(
    await siblingReply.locator(".message-content").innerText(),
    siblingText,
  );
  assert.equal(await editor.inputValue(), selectiveDraft);
  assert.equal(requests.length, 5);
  Object.assign(selectiveStopEvidence, { phase: "complete", restored: true });
  checks.push(
    "targeted Stop retains partial text, leaves its sibling streaming and draft intact, and remains scoped after renderer reload",
  );
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("STOP_TEST");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop responses", exact: true })
    .waitFor();
  await page
    .getByRole("article", { name: "Response from smoke-a", exact: true })
    .last()
    .getByText("still thinking", { exact: false })
    .waitFor();
  const composingDraft = "未確定の入力";
  const composingEditor = page.getByRole("textbox", {
    name: "Message",
    exact: true,
  });
  await composingEditor.fill(composingDraft);
  const activeText = page
    .getByRole("article", { name: "Response from smoke-a", exact: true })
    .last()
    .locator(".message-content");
  const beforeComposition = (await activeText.textContent()).length;
  await composingEditor.dispatchEvent("keydown", {
    key: "Escape",
    code: "Escape",
    isComposing: true,
  });
  // Require fresh native stream growth beyond a possible final buffered chunk,
  // rather than an immediate visibility check that could race cancellation.
  await page.waitForFunction((previousLength) => {
    const replies = document.querySelectorAll(
      'article[aria-label="Response from smoke-a"] .message-content',
    );
    return (
      replies.length > 0 &&
      (replies[replies.length - 1].textContent?.length ?? 0) >=
        previousLength + 3 * "still thinking ".length &&
      document.querySelector('button[aria-label="Stop responses"]') !== null
    );
  }, beforeComposition);
  assert.equal(await composingEditor.inputValue(), composingDraft);
  await page.keyboard.press("Escape");
  await page
    .getByRole("article", { name: "Response from smoke-a", exact: true })
    .last()
    .getByText("Stopped. Partial text was saved.", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Stop responses" })
    .waitFor({ state: "hidden" });
  assert.equal(await composingEditor.inputValue(), composingDraft);
  checks.push(
    "IME composition Escape preserves ongoing native streams and draft; ordinary Escape stops responses",
  );
  checks.push("cancel parallel streams and retain partial response");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("STOP_TEST reload during streaming");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByRole("button", { name: "Stop responses" }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Stop responses" }).waitFor();
  await page.getByRole("button", { name: "Stop responses" }).click();
  await page
    .getByRole("button", { name: "Stop responses" })
    .waitFor({ state: "hidden" });
  checks.push(
    "in-flight reload reconciles native state and Stop remains usable",
  );
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Draft survives reload");
  await page
    .getByText("Saving draft…", { exact: true })
    .waitFor({ state: "hidden" });
  await page.reload();
  await page.waitForFunction(() => {
    const prompt = document.querySelector("#prompt");
    return prompt && !prompt.disabled;
  });
  assert.equal(
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .inputValue(),
    "Draft survives reload",
  );
  await page
    .getByText("Grüezi 🦀. A persisted response from smoke-b.", { exact: true })
    .waitFor();
  checks.push(
    "reload preserves draft, retained chat selection and messages from SQLite",
  );
  await page
    .getByRole("button", { name: "Keep this chat", exact: true })
    .click();
  await page.getByText("30 days left").waitFor({ state: "hidden" });
  checks.push("convert Delete Soon to a permanent chat");
  await page.getByRole("button", { name: "Bots", exact: true }).click();
  await page.getByRole("button", { name: "New bot", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Concise writer");
  await page
    .getByRole("textbox", { name: "Instructions", exact: false })
    .fill("Use short sentences.");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("A workspace question");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByText("Grüezi 🦀. A persisted response from smoke-a.", { exact: true })
    .waitFor();
  assert.deepEqual(requests.at(-1).messages[0], {
    role: "system",
    content: "Use short sentences.",
  });
  checks.push("bot instructions reach the real native provider request");
  const savedWorkspace = await page.evaluate(async () => {
    const workspaces = await window.__TAURI_INTERNALS__.invoke(
      "list_workspaces",
      {},
    );
    return workspaces.find((item) => item.name === "Concise writer");
  });
  assert.ok(savedWorkspace, "The created bot must exist in native SQLite");
  const linkedChats = await page.evaluate(async (id) => {
    const chats = await window.__TAURI_INTERNALS__.invoke("list_chats", {
      offset: 0,
      search: "",
    });
    return chats
      .filter((chat) => chat.workspaceId === id)
      .map((chat) => chat.id)
      .sort();
  }, savedWorkspace.id);
  await page
    .getByRole("button", { name: "Edit name and instructions", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Discard this edit");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("aria-label") ===
      "Edit name and instructions",
  );
  await page
    .getByRole("button", { name: "Edit name and instructions", exact: true })
    .click();
  assert.equal(
    await page.getByRole("textbox", { name: "Name", exact: true }).inputValue(),
    "Concise writer",
  );
  const editedInstructions = page.getByRole("textbox", {
    name: /Instructions/,
  });
  const oversizedRules = "界".repeat(2731);
  await editedInstructions.fill(oversizedRules);
  await page.getByRole("alert").filter({ hasText: "8 KiB" }).waitFor();
  assert.equal(await editedInstructions.inputValue(), oversizedRules);
  assert.equal(
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .isDisabled(),
    true,
  );
  await editedInstructions.fill("My unsaved rules");
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("My unsaved name");
  // A second native client changes the exact synthetic row after this editor
  // opened. The stale UI save must not overwrite that acknowledged revision.
  await page.evaluate(
    async (expected) =>
      window.__TAURI_INTERNALS__.invoke("update_workspace", {
        expected,
        name: "Saved elsewhere",
        instructions: "Other saved rules",
      }),
    savedWorkspace,
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "changed or no longer exists" })
    .waitFor();
  assert.equal(await editedInstructions.inputValue(), "My unsaved rules");
  assert.equal(
    await page.getByRole("textbox", { name: "Name", exact: true }).inputValue(),
    "My unsaved name",
  );
  assert.equal(
    (
      await page.evaluate(
        async (id) =>
          window.__TAURI_INTERNALS__.invoke("get_workspace", { id }),
        savedWorkspace.id,
      )
    ).instructions,
    "Other saved rules",
  );
  await page.screenshot({
    path: join(evidence, "native-workspace-conflict.png"),
  });
  await page
    .getByRole("button", { name: "Load saved version", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector("#edit-workspace-name")?.value ===
      "Saved elsewhere",
  );
  assert.equal(await editedInstructions.inputValue(), "Other saved rules");
  checks.push(
    "stale workspace edit is rejected without losing the draft; explicit reload recovers native saved state",
  );
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Revised writer");
  await editedInstructions.fill("Use numbered steps.");
  const editorViewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  await page.setViewportSize({ width: 720, height: 620 });
  await page
    .getByRole("button", { name: "Save changes", exact: true })
    .scrollIntoViewIfNeeded();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: join(evidence, "native-workspace-edit.png") });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Edit bot", exact: true })
    .waitFor({ state: "hidden" });
  await page.setViewportSize(editorViewport);
  const afterEdit = await page.evaluate(
    async (id) => ({
      workspace: await window.__TAURI_INTERNALS__.invoke("get_workspace", {
        id,
      }),
      chats: (
        await window.__TAURI_INTERNALS__.invoke("list_chats", {
          offset: 0,
          search: "",
        })
      )
        .filter((chat) => chat.workspaceId === id)
        .map((chat) => chat.id)
        .sort(),
    }),
    savedWorkspace.id,
  );
  assert.equal(afterEdit.workspace.name, "Revised writer");
  assert.equal(afterEdit.workspace.kind, savedWorkspace.kind);
  assert.deepEqual(afterEdit.chats, linkedChats);
  await page.reload();
  await page
    .getByRole("button", { name: "Edit name and instructions", exact: true })
    .click();
  assert.equal(
    await page.getByRole("textbox", { name: "Name", exact: true }).inputValue(),
    "Revised writer",
  );
  assert.equal(
    await page.getByRole("textbox", { name: /Instructions/ }).inputValue(),
    "Use numbered steps.",
  );
  await page.keyboard.press("Escape");
  await page
    .locator(".message-user")
    .getByText("A workspace question", { exact: true })
    .waitFor();
  const requestsBeforeEditSend = requests.length;
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Updated workspace question");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop responses", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Stop responses", exact: true })
    .waitFor({ state: "hidden" });
  assert.equal(requests.length, requestsBeforeEditSend + 2);
  for (const request of requests.slice(requestsBeforeEditSend)) {
    assert.deepEqual(request.messages[0], {
      role: "system",
      content: "Use numbered steps.",
    });
    assert.equal(request.messages.at(-1).content, "Updated workspace question");
  }
  checks.push(
    "edited bot name/instructions survive native reload, preserve linked chats and reach the next actual provider request",
  );
  for (const name of ["Projects", "Spaces", "Images", "Videos"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page
      .getByRole("heading", {
        name:
          name === "Images"
            ? "A space for the visual."
            : name === "Videos"
              ? "Ideas, in motion."
              : name,
        exact: true,
      })
      .waitFor();
  }
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.screenshot({ path: join(evidence, "native-final.png") });
  assert.deepEqual(diagnostics, []);
  checks.push("all six workflow routes, no renderer errors");
  await page.keyboard.press("Control+k");
  await page
    .getByRole("textbox", { name: "Search chat titles", exact: true })
    .fill("workspace question");
  await page
    .getByRole("button", {
      name: "Open chat A workspace question",
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: "Close search", exact: true }).click();
  await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
  await page.setViewportSize({ width: 720, height: 620 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: join(evidence, "native-narrow.png") });
  const narrowPrompt = page.getByRole("textbox", {
    name: "Message",
    exact: true,
  });
  const previousDraft = await narrowPrompt.inputValue();
  await narrowPrompt.fill(
    Array(30).fill("A longer thought on its own line.").join("\n"),
  );
  await page.screenshot({
    animations: "disabled",
    path: join(evidence, "native-composer-multiline.png"),
  });
  assert.equal(
    await page.evaluate(() => {
      const input = document
        .querySelector(".composer textarea")
        .getBoundingClientRect();
      const send = document
        .querySelector(".composer [type='submit']")
        .getBoundingClientRect();
      return (
        input.bottom <= send.top &&
        send.bottom <= innerHeight &&
        document.documentElement.scrollWidth <= innerWidth
      );
    }),
    true,
    "Long drafts must leave the send action visible and separate from text",
  );
  await narrowPrompt.fill(previousDraft);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByRole("button", { name: "Provider connections", exact: true })
    .click();
  const apiKey = page.getByLabel("Gemini API key", { exact: true });
  await page
    .getByText(
      "Add a Gemini API key. API usage has separate limits and billing.",
      { exact: true },
    )
    .waitFor();
  await apiKey.scrollIntoViewIfNeeded();
  assert.equal(await apiKey.getAttribute("type"), "password");
  assert.equal(await apiKey.inputValue(), "");
  const saveKey = page.getByRole("button", { name: "Save key", exact: true });
  assert.equal(await saveKey.isDisabled(), true);
  await apiKey.fill("invalid key");
  assert.equal(await apiKey.getAttribute("aria-invalid"), "true");
  assert.equal(await saveKey.isDisabled(), true);
  await apiKey.fill("");
  // This unique synthetic profile has no key. Exercise idempotent native removal
  // only; never save a real/synthetic valid key or call Google's API in this run.
  await page.getByRole("button", { name: "Remove key", exact: true }).click();
  await page.getByText("API key removed.", { exact: true }).waitFor();
  await page
    .getByText(
      "Add a Gemini API key. API usage has separate limits and billing.",
      { exact: true },
    )
    .waitFor();
  await page.screenshot({
    path: join(evidence, "native-gemini-connection.png"),
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  checks.push(
    "Gemini API connection masks input, rejects invalid keys and removes only the empty synthetic-profile credential without API calls",
  );
  const claudeKey = page.getByLabel("Claude API key", { exact: true });
  const claudeWorkspace = page.getByLabel("Workspace ID (optional)", {
    exact: true,
  });
  const saveConnection = page.getByRole("button", {
    name: "Save connection",
    exact: true,
  });
  await claudeKey.scrollIntoViewIfNeeded();
  assert.equal(await claudeKey.getAttribute("type"), "password");
  assert.equal(await claudeKey.inputValue(), "");
  assert.equal(await claudeWorkspace.inputValue(), "");
  assert.equal(await saveConnection.isDisabled(), true);
  await claudeKey.fill("invalid key");
  assert.equal(await claudeKey.getAttribute("aria-invalid"), "true");
  assert.equal(await saveConnection.isDisabled(), true);
  await claudeKey.fill("synthetic-not-saved-key");
  await claudeWorkspace.fill("invalid_workspace");
  assert.equal(await claudeWorkspace.getAttribute("aria-invalid"), "true");
  assert.equal(await saveConnection.isDisabled(), true);
  await page
    .getByText(
      "Use a Workspace ID starting with wrkspc_ and containing only letters, numbers or underscores.",
      { exact: true },
    )
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(evidence, "native-claude-validation.png"),
  });
  await claudeWorkspace.fill("wrkspc_synthetic");
  assert.equal(await saveConnection.isEnabled(), true);
  // Never save this valid-looking synthetic key or make a provider request.
  // Removal exercises only the fresh profile's absent native connection target.
  await page
    .getByRole("button", { name: "Remove connection", exact: true })
    .click();
  await page.getByText("Claude connection removed.", { exact: true }).waitFor();
  await page
    .getByText("Add a Claude Console API key. API usage and billing apply.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await claudeKey.inputValue(), "");
  assert.equal(await claudeWorkspace.inputValue(), "");
  await page
    .getByRole("button", { name: "Remove connection", exact: true })
    .scrollIntoViewIfNeeded();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: join(evidence, "native-claude-connection.png"),
  });
  checks.push(
    "Claude API connection masks input, validates workspace/key together and removes only the empty profile connection without provider calls",
  );
  const xaiKey = page.getByLabel("xAI API key", { exact: true });
  await xaiKey.scrollIntoViewIfNeeded();
  assert.equal(await xaiKey.getAttribute("type"), "password");
  assert.equal(await xaiKey.inputValue(), "");
  const saveXai = page.getByRole("button", {
    name: "Save xAI key",
    exact: true,
  });
  assert.equal(await saveXai.isDisabled(), true);
  await xaiKey.fill("invalid key");
  assert.equal(await xaiKey.getAttribute("aria-invalid"), "true");
  assert.equal(await saveXai.isDisabled(), true);
  await page
    .getByText("Use an API key without spaces or non-ASCII characters.", {
      exact: true,
    })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(evidence, "native-xai-validation.png") });
  // This profile still has no xAI key. Exercise native removal only, never save
  // a valid-looking key or contact the real xAI API from the UI fixture.
  await page
    .getByRole("button", { name: "Remove xAI key", exact: true })
    .click();
  await page.getByText("xAI API key removed.", { exact: true }).waitFor();
  await page
    .getByText(
      "Add an xAI API key. API usage has separate limits and billing.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await xaiKey.inputValue(), "");
  await page
    .getByRole("button", { name: "Get xAI API key", exact: true })
    .scrollIntoViewIfNeeded();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: join(evidence, "native-xai-connection.png") });
  checks.push(
    "xAI API connection masks/rejects invalid input and removes only the empty profile key without provider calls",
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  checks.push(
    "keyboard search, narrow WebView layout, reduced-motion modal dismissal",
  );
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Draft survives process restart");
  await page
    .getByText("Saving draft…", { exact: true })
    .waitFor({ state: "hidden" });
  await close();
  page = await launch();
  assert.equal(
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .inputValue(),
    "Draft survives process restart",
  );
  await page
    .getByText("Grüezi 🦀. A persisted response from smoke-a.", { exact: true })
    .last()
    .waitFor();
  await page
    .locator(".message-user")
    .getByText("Updated workspace question", { exact: true })
    .waitFor();
  checks.push("full native process restart restores SQLite draft and messages");
  await writeFile(
    join(evidence, "native-smoke.json"),
    JSON.stringify(
      {
        context,
        executable,
        data,
        profile,
        databaseDirectory,
        checks,
        requests: requests.length,
        selectiveStop: selectiveStopEvidence,
        selectiveProducers: Object.fromEntries(selectiveStreams),
        fixture:
          "synthetic local Ollama-compatible HTTP server; no inference or paid requests",
        result: "passed",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ result: "passed", checks, evidence, data }, null, 2),
  );
} catch (error) {
  await writeFile(
    join(evidence, "native-smoke.json"),
    JSON.stringify(
      {
        context,
        result: "failed",
        checks,
        selectiveStop: selectiveStopEvidence,
        selectiveProducers: Object.fromEntries(selectiveStreams),
        error: String(error),
      },
      null,
      2,
    ),
  );
  if (browser)
    await browser
      .contexts()[0]
      .pages()[0]
      ?.screenshot({ path: join(evidence, "native-failure.png") })
      .catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await close();
  await new Promise((resolve) => mock.close(resolve));
}
