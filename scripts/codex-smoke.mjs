import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { verificationContext } from "./verification-context.mjs";
import { randomUUID } from "node:crypto";

const root = resolve(import.meta.dirname, "..");
const release = process.argv.includes("--release");
const executable = join(
  root,
  release ? "target/release/pavane.exe" : "target/debug/pavane.exe",
);
const context = await verificationContext(
  root,
  executable,
  release ? "release" : "debug",
);
const data = await mkdtemp(join(tmpdir(), "pavane-codex-"));
const profile = release ? `verify-codex-${randomUUID()}` : null;
const databaseDirectory = profile
  ? join(process.env.LOCALAPPDATA, "cloud.pavane.desktop", "profiles", profile)
  : data;
const evidence = process.env.PAVANE_EVIDENCE_DIR ?? join(root, "evidence");
await mkdir(evidence, { recursive: true });
await writeFile(
  join(evidence, "codex-smoke.json"),
  JSON.stringify(
    {
      context,
      profile,
      data,
      databaseDirectory,
      result: "running",
      checks: [],
    },
    null,
    2,
  ),
);
const child = spawn(executable, profile ? ["--profile", profile] : [], {
  cwd: root,
  windowsHide: false,
  env: {
    ...process.env,
    PAVANE_DATA_DIR: data,
    WEBVIEW2_USER_DATA_FOLDER: join(data, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9423",
  },
  stdio: "ignore",
});
let browser;
const errors = [];
const checks = [];
const canary = join(data, "host-canary");
const unopened = spawn(
  executable,
  [
    "--pavane-codex-host",
    process.execPath,
    "-e",
    `require('node:fs').writeFileSync(${JSON.stringify(canary)},'unexpected')`,
  ],
  { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] },
);
unopened.stdin.end();
await new Promise((resolve) => unopened.once("exit", resolve));
assert.equal(
  await access(canary).then(
    () => true,
    () => false,
  ),
  false,
);
checks.push(
  "provider host exits on parent EOF without starting its provider before the job gate",
);
const echoed = spawn(
  executable,
  [
    "--pavane-codex-host",
    process.execPath,
    "-e",
    "process.stdin.pipe(process.stdout)",
  ],
  { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] },
);
let echoedInput = "";
echoed.stdout.on("data", (chunk) => {
  echoedInput += chunk;
});
echoed.stdin.end("PAVANEGOinitialize-json\n");
await new Promise((resolve) => echoed.once("exit", resolve));
assert.equal(echoedInput, "initialize-json\n");
checks.push(
  "startup gate preserves immediately queued provider input without read-ahead loss",
);
try {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9423");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  assert.ok(browser, "Native Codex test WebView did not start");
  const page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("button", { name: /Model: GPT-6.1-Sol/ })
    .waitFor({ timeout: 45000 });
  checks.push(
    "zero-click Codex subscription discovery and default model selection",
  );
  await access(join(databaseDirectory, "pavane.sqlite3"));
  await page.getByRole("button", { name: /Change model/ }).click();
  await page.getByRole("combobox", { name: "Search models" }).waitFor();
  await page.screenshot({
    animations: "disabled",
    path: join(evidence, "codex-picker.png"),
  });
  await page
    .getByRole("button", { name: "Options for GPT-6.1-Sol", exact: true })
    .click();
  await page
    .getByRole("radiogroup", { name: "Reasoning for GPT-6.1-Sol", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("radio", { name: "Ultra", exact: true }).count(),
    1,
  );
  await page.screenshot({
    animations: "disabled",
    path: join(evidence, "codex-picker-options.png"),
  });
  await page.getByRole("radio", { name: "High", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Model: GPT-6.1-Sol, High. Change model",
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: /Change model/ }).click();
  await page
    .getByRole("button", { name: "Star GPT-6.1-Sol", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await page.reload();
  await page
    .getByRole("button", {
      name: "Model: GPT-6.1-Sol, High. Change model",
      exact: true,
    })
    .waitFor({ timeout: 45000 });
  checks.push(
    "reference-style picker, dynamic reasoning and service tiers, favourites and selection survive reload",
  );
  const prompt = page.getByRole("textbox", { name: "Message", exact: true });
  await prompt.fill(
    "Reply with a Markdown heading 'Pavane works', two short bullet points, and a fenced rust code block containing fn main() {}. Keep the reply under 70 words. Do not use tools.",
  );
  await prompt.press("Enter");
  await page
    .getByRole("heading", { name: "Pavane works", exact: true })
    .waitFor({ timeout: 90000 });
  await page
    .getByRole("button", { name: "Stop responses", exact: true })
    .waitFor({ state: "hidden", timeout: 90000 });
  await page.getByRole("button", { name: "Copy code", exact: true }).waitFor();
  assert.equal(
    await page.getByText("Codex · cloud", { exact: true }).count(),
    1,
  );
  await page.screenshot({
    animations: "disabled",
    path: join(evidence, "codex-chat.png"),
  });
  checks.push(
    "real GPT-6.1-Sol streamed through native IPC into Markdown, list and code block",
  );
  await page
    .getByRole("button", { name: "Provider connections", exact: true })
    .click();
  await page
    .getByText("Connected through your Codex CLI login", { exact: true })
    .waitFor();
  await page.screenshot({
    animations: "disabled",
    path: join(evidence, "codex-connections.png"),
  });
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.reload();
  await page
    .getByRole("heading", { name: "Pavane works", exact: true })
    .waitFor();
  checks.push(
    "real connection/limit display and Codex answer survives native renderer reload",
  );
  await page
    .getByRole("button", {
      name: "Model: GPT-6.1-Sol, High. Change model",
      exact: true,
    })
    .waitFor();
  await prompt.fill(
    "Write a long numbered list of imaginary ingredients, at least 5000 words. Begin immediately, no tools.",
  );
  await prompt.press("Enter");
  await page
    .getByRole("button", { name: "Stop responses", exact: true })
    .waitFor();
  await page.waitForFunction(
    () => {
      const content = [
        ...document.querySelectorAll(".message-assistant .message-content"),
      ].at(-1);
      return content && content.textContent.length > 60;
    },
    {},
    { timeout: 90000 },
  );
  await page
    .getByRole("button", { name: "Stop responses", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Stop responses", exact: true })
    .waitFor({ state: "hidden", timeout: 15000 });
  await page
    .getByText("Stopped. Partial text was saved.", { exact: true })
    .waitFor();
  checks.push(
    "real Codex turn interrupt stops generation and saves partial text",
  );
  assert.deepEqual(errors, []);
  const processQuery = `$all=@(Get-CimInstance Win32_Process);$ids=[System.Collections.Generic.HashSet[int]]::new();[void]$ids.Add(${child.pid});do{$before=$ids.Count;foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId)){[void]$ids.Add([int]$p.ProcessId)}}}while($before-ne$ids.Count);@($all|Where-Object{$ids.Contains([int]$_.ProcessId)-and$_.ProcessId-ne${child.pid}-and$_.Name-in@('pavane.exe','codex.exe')}|ForEach-Object{[int]$_.ProcessId})|ConvertTo-Json -Compress`;
  const owned = JSON.parse(
    execFileSync("pwsh", ["-NoProfile", "-Command", processQuery], {
      encoding: "utf8",
      windowsHide: true,
    }),
  );
  assert.ok(
    Array.isArray(owned) && owned.length >= 2,
    "Expected the scoped host and Codex child",
  );
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
  const survivors = execFileSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      `@(${owned.join(",")})|ForEach-Object{Get-Process -Id $_ -ErrorAction SilentlyContinue}|Select-Object -ExpandProperty Id`,
    ],
    { encoding: "utf8", windowsHide: true },
  ).trim();
  assert.equal(survivors, "");
  checks.push(
    "forced desktop termination closes the owned Windows job and kills host/provider descendants",
  );
  await writeFile(
    join(evidence, "codex-smoke.json"),
    JSON.stringify(
      {
        context,
        result: "passed",
        checks,
        data,
        profile,
        databaseDirectory,
        model: "codex:gpt-6.1-sol",
        reasoning: "high",
        inference:
          "two synthetic real subscription turns, one interrupted; no API keys or raw auth files used",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ result: "passed", checks, data, profile }, null, 2),
  );
} catch (error) {
  await writeFile(
    join(evidence, "codex-smoke.json"),
    JSON.stringify(
      {
        context,
        profile,
        data,
        databaseDirectory,
        result: "failed",
        checks,
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
      ?.screenshot({ path: join(evidence, "codex-failure.png") })
      .catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
}
