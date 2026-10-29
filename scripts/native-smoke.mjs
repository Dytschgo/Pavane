import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { chromium } from "playwright-core";

// Drives the actual debug Windows WebView, never a browser storage imitation.
// Run only with no Ollama service on 11434; a bind error leaves it untouched.
const root = resolve(import.meta.dirname, "..");
const data = await mkdtemp(join(tmpdir(), "pavane-smoke-"));
const evidence = process.env.PAVANE_EVIDENCE_DIR ?? join(root, "evidence");
await mkdir(evidence, { recursive: true });
const requests = [];
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
  if (last.includes("FAIL_TEST")) {
    response.end('{"error":"synthetic failure"}\n');
    return;
  }
  const chunks = last.includes("STOP_TEST")
    ? Array(300).fill("still thinking ")
    : ["Grüezi 🦀. ", "A persisted response ", `from ${payload.model}.`];
  let index = 0;
  const timer = setInterval(() => {
    if (index < chunks.length)
      response.write(
        JSON.stringify({ message: { content: chunks[index++] }, done: false }) +
          "\n",
      );
    else {
      clearInterval(timer);
      response.end('{"done":true}\n');
    }
  }, 90);
  response.on("close", () => clearInterval(timer));
});
await new Promise((resolve, reject) => {
  mock.once("error", reject);
  mock.listen(11434, "127.0.0.1", resolve);
});

let child;
let browser;
const diagnostics = [];
const executable = join(root, "target", "debug", "pavane.exe");
async function launch() {
  child = spawn(executable, [], {
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
  return page;
}
async function close() {
  if (browser) {
    await browser.close();
    browser = undefined;
  }
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
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
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Hello from the native smoke test");
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
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("STOP_TEST");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("still thinking", { exact: false }).first().waitFor();
  await page.getByRole("button", { name: "Stop responses" }).click();
  await page
    .getByText("Stopped. Partial text was saved.", { exact: true })
    .first()
    .waitFor();
  await page
    .getByRole("button", { name: "Stop responses" })
    .waitFor({ state: "hidden" });
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
    .waitFor();
  checks.push("full native process restart restores SQLite draft and messages");
  await writeFile(
    join(evidence, "native-smoke.json"),
    JSON.stringify(
      {
        executable,
        data,
        checks,
        requests: requests.length,
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
