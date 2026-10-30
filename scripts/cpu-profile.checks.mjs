import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeCpuProfile } from "./cpu-profile.mjs";

const node = (id, name, asset = "", children = []) => ({
  id,
  children,
  callFrame: {
    functionName: name,
    url: asset ? `http://tauri.localhost/assets/${asset}` : "",
    lineNumber: 0,
    columnNumber: 12,
  },
});
const fixture = () => ({
  startTime: 100,
  endTime: 12100,
  nodes: [
    node(1, "(root)", "", [2, 3]),
    node(2, "render", "index-a.js", [4]),
    node(3, "(idle)"),
    node(4, "parse", "markdown-b.js", [5]),
    node(5, "scan", "markdown-b.js"),
  ],
  samples: [5, 2, 3, 5],
  timeDeltas: [1000, 2000, 3000, 4000],
});
test("exclusive counts conserve samples; recursive same-asset stacks count once inclusively", () => {
  const result = summarizeCpuProfile(fixture());
  assert.equal(result.durationMs, 12);
  assert.equal(result.firstSampleOffsetMs, 1);
  assert.equal(result.lastSampleOffsetMs, 10);
  assert.equal(result.unsampledTailMs, 2);
  assert.equal(
    result.exclusiveAssets.reduce((total, row) => total + row.samples, 0),
    4,
  );
  assert.equal(
    result.exclusiveAssets.find((row) => row.asset === "asset:markdown-b.js")
      .samples,
    2,
  );
  assert.equal(
    result.inclusiveAssets.find((row) => row.asset === "asset:markdown-b.js")
      .samples,
    2,
  );
  assert.equal(
    result.inclusiveAssets.find((row) => row.asset === "asset:index-a.js")
      .samples,
    3,
  );
  assert.equal(
    result.topFrames.find((row) => row.functionName === "scan").samples,
    2,
  );
});
test("unknown URLs, credentials, query strings and unknown frame names never enter output", () => {
  for (const url of [
    "https://secret:password@tauri.localhost/assets/index.js",
    "https://tauri.localhost/assets/index.js?token=secret",
    "file:///private/auth.json",
    "http://other.example/assets/index.js",
  ]) {
    const data = fixture();
    data.nodes[4].callFrame.url = url;
    data.nodes[4].callFrame.functionName = "private-secret-name";
    const summary = summarizeCpuProfile(data);
    const output = JSON.stringify(summary);
    assert.ok(
      !output.includes("secret") &&
        !output.includes("password") &&
        !output.includes("auth.json"),
    );
    assert.ok(output.includes("unattributed"));
    assert.equal(
      summary.topFrames.find((row) => row.asset === "unattributed").line,
      null,
    );
    assert.equal(
      summary.topFrames.find((row) => row.asset === "unattributed").column,
      null,
    );
  }
});
test("missing, invalid or oversized profiles fail explicitly", () => {
  for (const mutate of [
    (p) => {
      delete p.samples;
    },
    (p) => {
      p.samples = [];
    },
    (p) => {
      p.timeDeltas.pop();
    },
    (p) => {
      p.timeDeltas[0] = -1;
    },
    (p) => {
      p.timeDeltas[0] = Infinity;
    },
    (p) => {
      p.endTime = p.startTime;
    },
    (p) => {
      p.endTime = p.startTime + 9000;
    },
    (p) => {
      p.nodes[0] = null;
    },
    (p) => {
      p.samples[0] = 999;
    },
    (p) => {
      p.nodes[4].id = 2;
    },
    (p) => {
      p.nodes[1].children.push(3);
    },
    (p) => {
      p.nodes[4].children.push(1);
    },
    (p) => {
      p.nodes[3].children = [];
    },
    (p) => {
      p.nodes = Array(100001).fill(p.nodes[0]);
    },
    (p) => {
      p.samples = Array(200001).fill(1);
    },
    (p) => {
      p.nodes = Array.from({ length: 514 }, (_, i) =>
        node(i + 1, i ? "deep" : "(root)", "", i < 513 ? [i + 2] : []),
      );
      p.samples = [514];
      p.timeDeltas = [1000];
    },
  ]) {
    const data = fixture();
    mutate(data);
    assert.throws(() => summarizeCpuProfile(data), /CPU profile:/);
  }
});
test("large attribution sets retain top rows and account for omitted exclusive samples", () => {
  const data = {
    startTime: 0,
    endTime: 100000,
    nodes: [node(1, "(root)", "", [])],
    samples: [],
    timeDeltas: [],
  };
  for (let i = 2; i <= 81; i++) {
    data.nodes[0].children.push(i);
    data.nodes.push(node(i, "x".repeat(1000), `chunk-${i}.js`));
    data.samples.push(i);
    data.timeDeltas.push(1000);
  }
  const result = summarizeCpuProfile(data);
  assert.equal(result.exclusiveAssets.length, 20);
  assert.equal(result.inclusiveAssets.length, 20);
  assert.equal(result.topFrames.length, 20);
  assert.equal(result.topStacks.length, 8);
  assert.equal(
    result.exclusiveAssets.reduce((sum, row) => sum + row.samples, 0) +
      result.otherExclusiveSamples,
    80,
  );
  assert.ok(JSON.stringify(result).length < 48000);
});
test("a long gap before one sample does not inflate its ownership ranking", () => {
  const data = fixture();
  data.samples = [5, 3];
  data.timeDeltas = [10000, 1000];
  const result = summarizeCpuProfile(data);
  assert.equal(
    result.exclusiveAssets.find((row) => row.asset === "asset:markdown-b.js")
      .sampleShare,
    0.5,
  );
  assert.equal(
    result.exclusiveAssets.find((row) => row.asset === "(idle)").sampleShare,
    0.5,
  );
});
