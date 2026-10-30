import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  digest,
  inputDirectory,
  sourcePath,
  verifyPrebuilt,
} from "./prebuilt-input.mjs";

const root = resolve(import.meta.dirname, "..");
if (process.argv.includes("--verify-only")) {
  await verifyPrebuilt(root);
  console.log("Prebuilt executable and transported source hashes match.");
  process.exit(0);
}
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
const snapshot = async () => {
  const paths = git(
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  )
    .split("\0")
    .filter(sourcePath)
    .sort();
  return Promise.all(
    paths.map(async (path) => ({
      path,
      sha256: digest(await readFile(join(root, path))),
    })),
  );
};
const revision = git("rev-parse", "HEAD").trim();
assert.equal(
  git("status", "--porcelain", "--untracked-files=no").trim(),
  "",
  "Commit tracked changes before preparing a pinned build",
);
assert.deepEqual(
  git("ls-files", "-z", "--others", "--exclude-standard")
    .split("\0")
    .filter(sourcePath),
  [],
  "Untracked application or harness source is not a pinned candidate",
);
const files = await snapshot();
// Fixed command, no caller-provided shell text. The source must not change
// between this snapshot and the completed locked desktop build.
execFileSync("cmd.exe", ["/d", "/s", "/c", "pnpm desktop:build"], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});
assert.deepEqual(await snapshot(), files, "Source changed during build");
assert.equal(git("rev-parse", "HEAD").trim(), revision);
const binary = await readFile(join(root, "target/release/pavane.exe"));
const manifest = {
  schemaVersion: 1,
  mode: "prebuilt-ui",
  revision,
  capturedAt: new Date().toISOString(),
  buildCommand: "pnpm desktop:build",
  buildRust: execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim(),
  buildNode: process.version,
  files,
  sourceSha256: digest(JSON.stringify(files)),
  binary: { bytes: binary.length, sha256: digest(binary) },
};
await mkdir(join(root, inputDirectory), { recursive: true });
await copyFile(
  join(root, "target/release/pavane.exe"),
  join(root, inputDirectory, "pavane.exe"),
);
await writeFile(
  join(root, inputDirectory, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
await verifyPrebuilt(root);
console.log(
  JSON.stringify({
    revision,
    binary: manifest.binary,
    sourceSha256: manifest.sourceSha256,
  }),
);
