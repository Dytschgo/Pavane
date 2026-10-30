import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import { verificationContext } from "./verification-context.mjs";

const root = resolve(import.meta.dirname, "..");
const executable = join(root, "target/release/pavane.exe");
const evidence = process.env.PAVANE_EVIDENCE_DIR ?? join(root, "evidence");
const context = await verificationContext(root, executable, "release");
const checks = [];
const samples = [];
const launches = [];
await mkdir(evidence, { recursive: true });
const report = (result, extra = {}) =>
  writeFile(
    join(evidence, "release-smoke.json"),
    JSON.stringify(
      {
        result,
        context,
        checks,
        samples,
        launches,
        conditions:
          "Warm Windows machine, fresh isolated SQLite/WebView2 profile per launch, CDP enabled, idle sample 5 seconds after discovery. No inference. Working-set sums can double-count shared pages; not a cold-OS, peak-load or comparative benchmark.",
        ...extra,
      },
      null,
      2,
    ),
  );
await report("running");

function memory(pid) {
  const script = `$all=@(Get-CimInstance Win32_Process);$ids=[System.Collections.Generic.HashSet[int]]::new();[void]$ids.Add(${pid});do{$before=$ids.Count;foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId)){[void]$ids.Add([int]$p.ProcessId)}}}while($before-ne$ids.Count);$rows=@(foreach($taskId in $ids){$p=Get-Process -Id $taskId -ErrorAction SilentlyContinue;if($p){[pscustomobject]@{id=$p.Id;name=$p.ProcessName;workingSetBytes=$p.WorkingSet64;privateBytes=$p.PrivateMemorySize64}}});ConvertTo-Json -InputObject $rows -Compress`;
  const processes = JSON.parse(
    execFileSync("pwsh", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
    }),
  );
  assert.ok(
    processes.some((p) => p.id === pid),
    "Owned release process disappeared",
  );
  return {
    processes,
    workingSetBytes: processes.reduce((n, p) => n + p.workingSetBytes, 0),
    privateBytes: processes.reduce((n, p) => n + p.privateBytes, 0),
  };
}

let browser;
async function requireFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(9424, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => server.close(resolve));
}

try {
  for (let run = 1; run <= 3; run++) {
    // Refuse to attach to any pre-existing debugging endpoint.
    await requireFreePort();
    const data = await mkdtemp(join(tmpdir(), "pavane-release-"));
    const started = performance.now();
    const profile = `verify-${randomUUID()}`;
    launches.push({ run, profile, webViewDirectory: join(data, "webview") });
    await report("running");
    const child = spawn(executable, ["--profile", profile], {
      cwd: root,
      stdio: "ignore",
      env: {
        ...process.env,
        WEBVIEW2_USER_DATA_FOLDER: join(data, "webview"),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9424",
      },
    });
    let launchError;
    child.on("error", (error) => {
      launchError = error;
    });
    const closed = new Promise((resolve) => child.once("close", resolve));
    try {
      const deadline = Date.now() + 30000;
      while (
        Date.now() < deadline &&
        !launchError &&
        child.exitCode === null &&
        child.signalCode === null
      ) {
        try {
          browser = await chromium.connectOverCDP("http://127.0.0.1:9424");
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      if (launchError) throw launchError;
      assert.ok(browser, "Release WebView did not start");
      const page = browser.contexts()[0].pages()[0];
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const input = page.getByRole("textbox", { name: "Message", exact: true });
      await input.waitFor();
      await page.waitForFunction(
        () => !document.querySelector("#prompt").disabled,
      );
      const composerReadyMs = Math.round(performance.now() - started);
      await access(
        join(
          process.env.LOCALAPPDATA,
          "cloud.pavane.desktop",
          "profiles",
          profile,
          "pavane.sqlite3",
        ),
      );
      assert.equal(
        new URL(page.url()).hostname,
        "tauri.localhost",
        "Release must load its bundled renderer",
      );
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .waitFor({ timeout: 45000 });
      const discoverySettledMs = Math.round(performance.now() - started);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      samples.push({
        run,
        composerReadyMs,
        discoverySettledMs,
        ...memory(child.pid),
      });
      if (run === 1) {
        await page.screenshot({
          animations: "disabled",
          path: join(evidence, "release-empty.png"),
        });
        for (const name of [
          "Projects",
          "Spaces",
          "Bots",
          "Images",
          "Videos",
          "Chat",
        ]) {
          await page.getByRole("button", { name, exact: true }).click();
          await page
            .getByRole("button", { name, exact: true })
            .getAttribute("aria-current")
            .then((value) => assert.equal(value, "page"));
        }
        await input.fill("A draft saved by the standalone release");
        await page
          .getByText("Saving draft…", { exact: true })
          .waitFor({ state: "hidden" });
        await page.getByText("Saved on this device", { exact: true }).waitFor();
        await page.reload();
        await page.waitForFunction(
          () =>
            document.querySelector("#prompt")?.value ===
            "A draft saved by the standalone release",
        );
        await page
          .getByRole("button", { name: "Send message", exact: true })
          .waitFor({ timeout: 45000 });
        await page.screenshot({
          animations: "disabled",
          path: join(evidence, "release-draft.png"),
        });
        checks.push(
          "optimized executable loads bundled renderer, all six routes and native SQLite draft survives reload",
        );
      }
      assert.deepEqual(errors, []);
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
        browser = undefined;
      }
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
      // WebView2 releases its debugging listener shortly after the host exits.
      // Wait for that observed resource, never kill a process owning the port.
      const deadline = Date.now() + 15000;
      for (;;) {
        try {
          await requireFreePort();
          break;
        } catch (error) {
          if (error.code !== "EADDRINUSE" || Date.now() >= deadline)
            throw error;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
    }
  }
  checks.push(
    "three isolated warm-machine launches with full owned process-tree memory samples",
  );
  await report("passed");
  console.log(
    JSON.stringify(
      {
        result: "passed",
        checks,
        samples: samples.map(({ processes, ...sample }) => ({
          ...sample,
          processCount: processes.length,
        })),
      },
      null,
      2,
    ),
  );
} catch (error) {
  await report("failed", { error: String(error) });
  throw error;
}
