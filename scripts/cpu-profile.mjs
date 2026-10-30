const MAX_NODES = 100000;
const MAX_SAMPLES = 200000;
const MAX_DEPTH = 512;
const runtimeNames = new Set([
  "(root)",
  "(idle)",
  "(program)",
  "(garbage collector)",
]);
function requireValue(condition, message) {
  if (!condition) throw new Error(`CPU profile: ${message}`);
}
function frameInfo(frame) {
  let asset = "unattributed";
  try {
    const url = new URL(frame.url);
    if (
      ["http:", "https:"].includes(url.protocol) &&
      url.hostname === "tauri.localhost" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/assets\/[\w.-]{1,90}\.js$/.test(url.pathname)
    )
      asset = `asset:${url.pathname.slice("/assets/".length)}`;
  } catch {
    /* Native/evaluated frames often have no URL. */
  }
  const runtime = !frame.url && runtimeNames.has(frame.functionName);
  if (runtime) asset = frame.functionName;
  const owned = asset.startsWith("asset:");
  return {
    asset,
    functionName: runtime
      ? frame.functionName
      : owned
        ? frame.functionName.replace(/[^\u0020-\u007e]/g, "?").slice(0, 80) ||
          "<anonymous>"
        : "<unattributed>",
    line:
      owned && Number.isInteger(frame.lineNumber) && frame.lineNumber >= 0
        ? frame.lineNumber
        : null,
    column:
      owned && Number.isInteger(frame.columnNumber) && frame.columnNumber >= 0
        ? frame.columnNumber
        : null,
  };
}
const ms = (microseconds) => Math.round(microseconds) / 1000;
function add(map, key, data) {
  const row = map.get(key) ?? { ...data, samples: 0 };
  row.samples++;
  map.set(key, row);
}
function ranked(map, limit, total) {
  return [...map.values()]
    .sort((a, b) => b.samples - a.samples)
    .slice(0, limit)
    .map((row) => ({ ...row, sampleShare: row.samples / total }));
}

// Analyze only the owned synthetic WebView. Export bounded attribution, never
// source text, complete URLs, raw profile nodes or application message content.
export function summarizeCpuProfile(profile) {
  requireValue(
    profile &&
      Array.isArray(profile.nodes) &&
      profile.nodes.length > 0 &&
      profile.nodes.length <= MAX_NODES,
    "invalid node bounds",
  );
  requireValue(
    Array.isArray(profile.samples) &&
      profile.samples.length > 0 &&
      profile.samples.length <= MAX_SAMPLES,
    "invalid sample bounds",
  );
  requireValue(
    Array.isArray(profile.timeDeltas) &&
      profile.timeDeltas.length === profile.samples.length,
    "missing or mismatched sample intervals",
  );
  const duration = profile.endTime - profile.startTime;
  requireValue(
    Number.isFinite(profile.startTime) &&
      Number.isFinite(profile.endTime) &&
      duration > 0 &&
      duration <= 300000000,
    "invalid time window",
  );
  const nodes = new Map();
  for (const node of profile.nodes) {
    requireValue(
      node && Number.isInteger(node.id) && !nodes.has(node.id),
      "duplicate/invalid node ID",
    );
    requireValue(
      node.callFrame &&
        typeof node.callFrame.functionName === "string" &&
        typeof node.callFrame.url === "string",
      "invalid call frame",
    );
    requireValue(
      node.children === undefined || Array.isArray(node.children),
      "invalid child list",
    );
    nodes.set(node.id, { ...node, frame: frameInfo(node.callFrame) });
  }
  const parents = new Map();
  for (const node of nodes.values()) {
    for (const child of node.children ?? []) {
      requireValue(
        nodes.has(child) && !parents.has(child),
        "missing/shared child node",
      );
      parents.set(child, node.id);
    }
  }
  const root = profile.nodes[0].id;
  requireValue(!parents.has(root), "root has a parent");
  const frames = new Map(),
    exclusive = new Map(),
    inclusive = new Map(),
    stacks = new Map();
  let elapsed = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const delta = profile.timeDeltas[i];
    requireValue(
      Number.isSafeInteger(delta) && delta >= 0 && delta <= 300000000,
      "invalid sample interval",
    );
    elapsed += delta;
    requireValue(
      elapsed <= duration,
      "sample timestamp exceeds capture window",
    );
    let id = profile.samples[i];
    requireValue(nodes.has(id), "sample references a missing node");
    const leaf = nodes.get(id).frame;
    add(frames, JSON.stringify(leaf), leaf);
    add(exclusive, leaf.asset, { asset: leaf.asset });
    const path = [],
      seen = new Set(),
      assets = new Set();
    while (id !== undefined) {
      requireValue(
        !seen.has(id) && path.length < MAX_DEPTH,
        "cyclic/overdeep stack",
      );
      seen.add(id);
      const frame = nodes.get(id).frame;
      path.push(frame);
      if (id !== root) assets.add(frame.asset);
      if (id === root) break;
      id = parents.get(id);
    }
    requireValue(id === root, "sample is disconnected from root");
    for (const asset of assets) add(inclusive, asset, { asset });
    // Keep the innermost sixteen frames; indicate when a deeper path was cut.
    const stack = path
      .filter((frame) => frame.asset !== "(root)")
      .slice(0, 16)
      .reverse();
    add(stacks, profile.samples[i], { stack, truncated: path.length > 17 });
  }
  requireValue(elapsed > 0, "empty sampled time");
  const total = profile.samples.length;
  return {
    schemaVersion: 1,
    durationMs: ms(duration),
    firstSampleOffsetMs: ms(profile.timeDeltas[0]),
    lastSampleOffsetMs: ms(elapsed),
    unsampledTailMs: ms(duration - elapsed),
    meanSampleSpacingMs:
      total > 1 ? ms((elapsed - profile.timeDeltas[0]) / (total - 1)) : null,
    sampleCount: profile.samples.length,
    nodeCount: profile.nodes.length,
    exclusiveAssets: ranked(exclusive, 20, total),
    otherExclusiveSamples: [...exclusive.values()]
      .sort((a, b) => b.samples - a.samples)
      .slice(20)
      .reduce((sum, row) => sum + row.samples, 0),
    inclusiveAssets: ranked(inclusive, 20, total),
    exclusiveAssetCount: exclusive.size,
    inclusiveAssetCount: inclusive.size,
    topFrames: ranked(frames, 20, total),
    topStacks: ranked(stacks, 8, total),
    note: "Rankings count observed stack samples, not exact CPU duration. Exclusive counts partition samples; inclusive assets are deduplicated per stack but overlap across assets. Irregular sampling and leading/tail gaps limit inference. Function locations are zero-based and may be minified. Only owned bundled asset names/locations and recognized runtime labels are exported; unknown URLs/names are hidden. Sampling overhead and the manual-read/resume workload preclude comparison with the unprofiled typing benchmark.",
  };
}
