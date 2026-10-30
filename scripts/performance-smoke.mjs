import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as portProbe } from "node:net";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { verificationContext } from "./verification-context.mjs";

const root = resolve(import.meta.dirname, "..");
const labelIndex = process.argv.indexOf("--label");
const label = labelIndex < 0 ? "sample" : process.argv[labelIndex + 1];
const historyOnly = process.argv.includes("--history-only");
const historyTurns = historyOnly ? 51 : 55;
assert.match(label, /^[a-z0-9-]{1,40}$/);
const executable = join(
  root,
  process.env.PAVANE_PREBUILT_VERIFICATION === "1"
    ? "verification-input/pavane.exe"
    : "target/release/pavane.exe",
);
const context = await verificationContext(root, executable, "release");
const evidence = process.env.PAVANE_EVIDENCE_DIR ?? join(root, "evidence");
await mkdir(evidence, { recursive: true });
const profile = `verify-perf-${randomUUID()}`;
const data = await mkdtemp(join(tmpdir(), "pavane-performance-"));
const sections = Array.from(
  { length: 300 },
  (_, i) =>
    `\n## Section ${i}\n\nA measured synthetic response with **formatted text** and a [safe link](https://example.com).\n\n| Item | Value |\n| --- | --- |\n| Alpha | ${i} |\n| Beta | persisted |\n\n\`\`\`rust\nfn section_${i}() {\n    println!("synthetic");\n}\n\`\`\`\n`,
);
const longText = sections.join("") + "\nEND_LONG_RESPONSE\n";
let streaming = false;
const mock = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/api/tags")
    return response.end(
      JSON.stringify({ models: [{ name: "performance-fixture" }] }),
    );
  if (request.url !== "/api/chat") return response.writeHead(404).end();
  let body = "";
  for await (const chunk of request) body += chunk;
  const prompt = JSON.parse(body).messages.at(-1).content;
  response.setHeader("content-type", "application/x-ndjson");
  if (prompt !== "LONG_STREAM")
    return response.end(
      JSON.stringify({
        message: {
          content: historyOnly
            ? `Saved response for ${prompt}.`
            : `${sections.slice(0, 3).join("")}\nEND_${prompt}\n`,
        },
        done: true,
      }) + "\n",
    );
  streaming = true;
  let i = 0;
  const timer = setInterval(() => {
    if (i < sections.length)
      response.write(
        JSON.stringify({ message: { content: sections[i++] }, done: false }) +
          "\n",
      );
    else {
      clearInterval(timer);
      streaming = false;
      response.end(
        JSON.stringify({
          message: { content: "\nEND_LONG_RESPONSE\n" },
          done: true,
        }) + "\n",
      );
    }
  }, 50);
  response.on("close", () => {
    clearInterval(timer);
    streaming = false;
  });
});
await new Promise((resolve, reject) => {
  mock.once("error", reject);
  mock.listen(11434, "127.0.0.1", resolve);
});
async function freePort() {
  const probe = portProbe();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(9425, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
}
const result = {
  label,
  context,
  profile,
  data,
  workload: {
    sections: historyOnly ? 0 : 300,
    intervalMs: historyOnly ? null : 50,
    outputBytes: historyOnly ? 0 : Buffer.byteLength(longText),
    historyTurns,
    historyOnly,
  },
  budgets: {
    typingP95Ms: 120,
    typingMaxMs: 500,
    historyAnchorShiftPx: 3,
    followGapPx: 24,
  },
  checks: [],
  result: "running",
  phase: "startup",
};
const report = () =>
  writeFile(
    join(evidence, `performance-${label}.json`),
    JSON.stringify(result, null, 2),
  );
await report();
let child, browser, launchError, page;
try {
  await freePort();
  child = spawn(executable, ["--profile", profile], {
    cwd: root,
    stdio: "ignore",
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: join(data, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9425",
    },
  });
  child.once("error", (error) => {
    launchError = error;
  });
  const deadline = Date.now() + 30000;
  while (
    Date.now() < deadline &&
    !launchError &&
    child.exitCode === null &&
    child.signalCode === null
  ) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9425");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (launchError) throw launchError;
  assert.ok(browser, "Owned WebView did not start");
  page = browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(60000);
  const editor = page.getByRole("textbox", { name: "Message", exact: true });
  await editor.waitFor();
  await page.waitForFunction(() => !document.querySelector("#prompt").disabled);
  await page.getByRole("button", { name: /Change model/ }).click();
  await page.getByRole("option", { name: /performance-fixture/ }).click();
  if (!historyOnly) {
    result.phase = "pinned-stream";
    // Warm the lazy Markdown module before the measured stream.
    await editor.fill("WARMUP");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page.getByText("END_WARMUP", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Stop responses" })
      .waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await page.waitForFunction(() => {
      const input = document.querySelector("#prompt");
      return (
        input &&
        !input.disabled &&
        document.querySelectorAll("article.message").length === 0
      );
    });
    const session = await page.context().newCDPSession(page);
    await session.send("Performance.enable");
    const before = await session.send("Performance.getMetrics");
    await page.evaluate(() => {
      window.__pavanePerf = {
        frames: [],
        longTasks: [],
        inputPaint: [],
        measuring: true,
      };
      let previous = performance.now();
      const tick = (now) => {
        if (!window.__pavanePerf.measuring) return;
        window.__pavanePerf.frames.push(now - previous);
        previous = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          if (window.__pavanePerf.measuring)
            window.__pavanePerf.longTasks.push(entry.duration);
      }).observe({ type: "longtask" });
      document.querySelector("#prompt").addEventListener("input", (event) => {
        if (window.__pavanePerf.measuring)
          requestAnimationFrame(() =>
            setTimeout(
              () =>
                window.__pavanePerf.inputPaint.push(
                  performance.now() - event.timeStamp,
                ),
              0,
            ),
          );
      });
    });
    const initialGap = await page.evaluate(() => {
      const area = document.querySelector(".conversation");
      return Math.max(
        0,
        area.scrollHeight - area.scrollTop - area.clientHeight,
      );
    });
    assert.ok(
      initialGap <= result.budgets.followGapPx,
      "Fixture must begin pinned to latest",
    );
    await editor.fill("LONG_STREAM");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page.getByRole("button", { name: "Stop responses" }).waitFor();
    await editor.focus();
    const keys = [];
    while (streaming || keys.length < 20) {
      const started = performance.now();
      const active = streaming;
      await page.keyboard.type("a");
      keys.push({
        latencyMs: performance.now() - started,
        providerActive: active,
      });
      await new Promise((resolve) => setTimeout(resolve, 160));
      if (keys.length >= 100) break;
    }
    await page.getByText("END_LONG_RESPONSE", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Stop responses" })
      .waitFor({ state: "hidden" });
    assert.equal(await editor.inputValue(), "a".repeat(keys.length));
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    // The scenario types only in the composer; it sends no wheel, page-up or
    // conversation-scroll input. A pinned reply should still end in view.
    const follow = await page.evaluate(() => {
      const area = document.querySelector(".conversation");
      return {
        gapPx: Math.max(
          0,
          area.scrollHeight - area.scrollTop - area.clientHeight,
        ),
        scrollTop: area.scrollTop,
        scrollHeight: area.scrollHeight,
        viewportHeight: area.clientHeight,
        composerFocused:
          document.activeElement === document.querySelector("#prompt"),
      };
    });
    const measurements = await page.evaluate(() => {
      window.__pavanePerf.measuring = false;
      return window.__pavanePerf;
    });
    const after = await session.send("Performance.getMetrics");
    const metric = (name) =>
      after.metrics.find((m) => m.name === name).value -
      before.metrics.find((m) => m.name === name).value;
    const sorted = keys
      .filter((k) => k.providerActive)
      .map((k) => k.latencyMs)
      .sort((a, b) => a - b);
    assert.ok(sorted.length >= 10, "Too few real streaming input samples");
    result.stream = {
      samples: keys,
      typingP95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
      typingMaxMs: sorted.at(-1),
      frameMaxMs: Math.max(...measurements.frames),
      longTaskCount: measurements.longTasks.length,
      longTaskMaxMs: Math.max(0, ...measurements.longTasks),
      inputPaintMaxMs: Math.max(0, ...measurements.inputPaint),
      scriptSeconds: metric("ScriptDuration"),
      layoutSeconds: metric("LayoutDuration"),
      taskSeconds: metric("TaskDuration"),
      follow: { initialGapPx: initialGap, ...follow },
    };
    await report();
    console.log(
      JSON.stringify({
        phase: "stream-measured",
        stream: { ...result.stream, samples: keys.length },
      }),
    );
    await page.screenshot({
      path: join(evidence, `performance-${label}-long.png`),
    });
    await page.reload();
    await editor.waitFor();
    await page.waitForFunction(
      (text) => document.querySelector("#prompt")?.value === text,
      "a".repeat(keys.length),
    );
    await page.getByText("END_LONG_RESPONSE", { exact: true }).waitFor();
    const retained = await page.evaluate(async () => {
      const bridge = window.__TAURI_INTERNALS__;
      const chats = await bridge.invoke("list_chats", {
        offset: 0,
        search: "LONG_STREAM",
      });
      const chat = chats.find((item) => item.title === "LONG_STREAM");
      if (!chat) throw new Error("Long-stream fixture chat is missing");
      const history = await bridge.invoke("get_messages", {
        chatId: chat.id,
        before: null,
      });
      return history.items.find((item) => item.role === "assistant")?.content;
    });
    assert.ok(
      retained === longText,
      "Full streamed response differs from the native SQLite fixture",
    );
    result.checks.push(
      "long streamed Markdown and concurrent typing survive native SQLite reload exactly",
    );

    // Exercise deliberate reading separately from the typing-only pinned repro.
    result.phase = "manual-reading-setup";
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await page.waitForFunction(
      () =>
        !document.querySelector("#prompt").disabled &&
        document.querySelectorAll("article.message").length === 0,
    );
    await page.evaluate(() => {
      const area = document.querySelector(".conversation");
      const trace = (window.__followTrace = []);
      const wheels = (window.__followWheels = []);
      for (const type of ["wheel", "scroll"])
        area.addEventListener(
          type,
          (event) => {
            const entry = {
              type,
              atMs: performance.now(),
              top: area.scrollTop,
              height: area.scrollHeight,
              viewport: area.clientHeight,
              deltaY: event.type === "wheel" ? event.deltaY : null,
              deltaMode: event.type === "wheel" ? event.deltaMode : null,
              target:
                event.target instanceof Element ? event.target.className : null,
            };
            trace.push(entry);
            if (trace.length > 80) trace.shift();
            if (type === "wheel") {
              wheels.push(entry);
              if (wheels.length > 4) wheels.shift();
            }
          },
          { passive: true },
        );
    });
    await editor.fill("LONG_STREAM");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".markdown h2").length >= 40,
    );
    const conversation = page.getByLabel("Conversation", { exact: true });
    const bounds = await conversation.boundingBox();
    assert.ok(bounds, "Conversation viewport is missing");
    await page.mouse.move(bounds.x + 12, bounds.y + 100);
    result.phase = "manual-reading-upward-wheel";
    await page.mouse.wheel(0, -1500);
    await page.waitForFunction(() => {
      const area = document.querySelector(".conversation");
      return area.scrollHeight - area.scrollTop - area.clientHeight > 1000;
    });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const reading = await page.evaluate(() => {
      const area = document.querySelector(".conversation");
      const bounds = area.getBoundingClientRect();
      window.__readingAnchor = [
        ...document.querySelectorAll(".markdown h2, .markdown p"),
      ].find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
      });
      if (!window.__readingAnchor) throw new Error("No visible reading anchor");
      return {
        top: window.__readingAnchor.getBoundingClientRect().top,
        text: window.__readingAnchor.textContent,
        sectionCount: document.querySelectorAll(".markdown h2").length,
        scrollHeight: area.scrollHeight,
      };
    });
    assert.ok(
      reading.sectionCount < 240,
      "Reading scenario began too late in the stream",
    );
    result.phase = "manual-reading-growth";
    await page.waitForFunction(
      (count) => document.querySelectorAll(".markdown h2").length >= count,
      reading.sectionCount + 40,
    );
    const readAfter = await page.evaluate(() => ({
      top: window.__readingAnchor.getBoundingClientRect().top,
      text: window.__readingAnchor.textContent,
      connected: window.__readingAnchor.isConnected,
      scrollHeight: document.querySelector(".conversation").scrollHeight,
    }));
    result.reading = {
      sectionCountBefore: reading.sectionCount,
      addedHeightPx: readAfter.scrollHeight - reading.scrollHeight,
      anchorShiftPx: Math.abs(readAfter.top - reading.top),
      sameText: readAfter.connected && reading.text === readAfter.text,
    };
    await report();
    await page.screenshot({
      path: join(evidence, `performance-${label}-reading.png`),
    });
    // Real downward input returns to latest; subsequent growth must follow again.
    result.phase = "resume-wheel";
    result.reading.beforeResume = await page.evaluate(() => {
      const area = document.querySelector(".conversation");
      return {
        top: area.scrollTop,
        height: area.scrollHeight,
        viewport: area.clientHeight,
      };
    });
    await report();
    await page.mouse.wheel(0, 10000000);
    result.phase = "resume-reach-latest";
    await page.waitForFunction(() => {
      const area = document.querySelector(".conversation");
      return area.scrollHeight - area.scrollTop - area.clientHeight <= 24;
    });
    const resumed = await page.evaluate(() => ({
      sectionCount: document.querySelectorAll(".markdown h2").length,
      scrollHeight: document.querySelector(".conversation").scrollHeight,
      active: !!document.querySelector('button[aria-label="Stop responses"]'),
    }));
    assert.ok(
      resumed.active && resumed.sectionCount < 260,
      "Must resume during an active stream",
    );
    result.reading.resumedSectionCount = resumed.sectionCount;
    result.phase = "resume-content-growth";
    await report();
    await page.waitForFunction(
      (count) => document.querySelectorAll(".markdown h2").length >= count,
      resumed.sectionCount + 20,
    );
    result.phase = "resume-stream-completion";
    await page.getByText("END_LONG_RESPONSE", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Stop responses" })
      .waitFor({ state: "hidden" });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    result.reading.resumedGapPx = await page.evaluate(() => {
      const area = document.querySelector(".conversation");
      return Math.max(
        0,
        area.scrollHeight - area.scrollTop - area.clientHeight,
      );
    });
    result.reading.growthAfterResumePx = await page.evaluate(
      (height) => document.querySelector(".conversation").scrollHeight - height,
      resumed.scrollHeight,
    );
    await report();
  }
  // Seed history through the actual native public chat/run commands, then open
  // it through the UI. No database editing or production-only fixture endpoint.
  result.phase = "history";
  const historyChat = await page.evaluate(async (turns) => {
    const bridge = window.__TAURI_INTERNALS__;
    const chat = await bridge.invoke("create_chat", {
      deleteSoon: false,
      workspaceId: null,
    });
    for (let i = 0; i < turns; i++) {
      let done;
      const finished = new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("History fixture terminal event timed out")),
          15000,
        );
        done = (event) => {
          clearTimeout(timer);
          resolve(event);
        };
      });
      const callback = bridge.transformCallback((raw) => {
        if ("end" in raw) bridge.unregisterCallback(callback);
        else if (raw.message.kind === "finished") done(raw.message);
      }, false);
      await bridge.invoke("send_message", {
        chatId: chat.id,
        content: `HISTORY_${String(i).padStart(2, "0")}`,
        models: ["ollama:performance-fixture"],
        onEvent: `__CHANNEL__:${callback}`,
        options: {},
      });
      const terminal = await finished;
      if (terminal.status !== "complete")
        throw new Error("History fixture response failed");
    }
    return chat;
  }, historyTurns);
  await page.reload();
  await editor.waitFor();
  await page
    .getByRole("button", { name: "Open chat HISTORY_00", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Load earlier messages", exact: true })
    .waitFor();
  const countBefore = await page.locator("article.message").count();
  assert.equal(countBefore, 100);
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".message-assistant .markdown").length === 50,
  );
  await page.evaluate(() => {
    const area = document.querySelector(".conversation");
    area.scrollTop = 0;
  });
  const anchor = await page.evaluate(() => {
    const area = document
      .querySelector(".conversation")
      .getBoundingClientRect();
    window.__historyAnchor = [
      ...document.querySelectorAll("article.message"),
    ].find((node) => node.getBoundingClientRect().top >= area.top);
    return {
      top: window.__historyAnchor.getBoundingClientRect().top,
      text: window.__historyAnchor.textContent,
      scrollTop: document.querySelector(".conversation").scrollTop,
      scrollHeight: document.querySelector(".conversation").scrollHeight,
    };
  });
  const loadStart = performance.now();
  await page
    .getByRole("button", { name: "Load earlier messages", exact: true })
    .click();
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll("article.message").length === count &&
      document.querySelectorAll(".message-assistant .markdown").length ===
        count / 2,
    historyTurns * 2,
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const anchorAfter = await page.evaluate(() => ({
    top: window.__historyAnchor.getBoundingClientRect().top,
    text: window.__historyAnchor.textContent,
    scrollTop: document.querySelector(".conversation").scrollTop,
    scrollHeight: document.querySelector(".conversation").scrollHeight,
  }));
  result.history = {
    chatId: historyChat.id,
    countBefore,
    countAfter: historyTurns * 2,
    loadMs: performance.now() - loadStart,
    anchorShiftPx: Math.abs(anchor.top - anchorAfter.top),
    sameText: anchor.text === anchorAfter.text,
    beforeScrollTop: anchor.scrollTop,
    afterScrollTop: anchorAfter.scrollTop,
    scrollHeightDelta: anchorAfter.scrollHeight - anchor.scrollHeight,
  };
  await page.screenshot({
    path: join(evidence, `performance-${label}-history.png`),
  });
  result.checks.push(
    "native history loaded across the 100-message page boundary",
  );
  const violations = [];
  if (result.stream && result.stream.typingP95Ms > result.budgets.typingP95Ms)
    violations.push("stream typing p95");
  if (result.stream && result.stream.typingMaxMs > result.budgets.typingMaxMs)
    violations.push("stream typing maximum");
  if (result.stream && result.stream.follow.gapPx > result.budgets.followGapPx)
    violations.push("stream auto-follow");
  if (
    result.reading &&
    (!result.reading.sameText ||
      result.reading.addedHeightPx <= 0 ||
      result.reading.anchorShiftPx > result.budgets.historyAnchorShiftPx)
  )
    violations.push("manual reading position during streaming");
  if (
    result.reading &&
    result.reading.resumedGapPx > result.budgets.followGapPx
  )
    violations.push("stream follow after returning to latest");
  if (result.reading && result.reading.growthAfterResumePx <= 0)
    violations.push("no content growth after resuming follow");
  if (
    !result.history.sameText ||
    result.history.anchorShiftPx > result.budgets.historyAnchorShiftPx
  )
    violations.push("history reading anchor");
  result.violations = violations;
  assert.deepEqual(violations, [], "Responsiveness budget exceeded");
  result.result = "passed";
  result.phase = "complete";
} catch (error) {
  result.result = "failed";
  result.error = String(error);
  result.errorStack = String(error.stack).split("\n").slice(0, 6);
  if (page) {
    result.failureViewport = await page
      .evaluate(() => {
        const area = document.querySelector(".conversation");
        return {
          top: area?.scrollTop,
          height: area?.scrollHeight,
          viewport: area?.clientHeight,
          sectionCount: document.querySelectorAll(".markdown h2").length,
          active: !!document.querySelector(
            'button[aria-label="Stop responses"]',
          ),
          trace: window.__followTrace ?? [],
          wheels: window.__followWheels ?? [],
        };
      })
      .catch(() => null);
    await page
      .screenshot({ path: join(evidence, `performance-${label}-failure.png`) })
      .catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await report();
  if (browser) await browser.close().catch(() => {});
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    const closed = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await closed;
  }
  mock.closeAllConnections();
  await new Promise((resolve) => mock.close(resolve));
  console.log(
    JSON.stringify(
      {
        ...result,
        stream: result.stream
          ? { ...result.stream, samples: result.stream.samples.length }
          : undefined,
      },
      null,
      2,
    ),
  );
}
