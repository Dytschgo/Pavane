import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { digest, sourcePath, verifyPrebuilt } from "./prebuilt-input.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pavane-prebuilt-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = [];
  for (const path of [
    "package.json",
    "pnpm-lock.yaml",
    "Cargo.lock",
    "scripts/native-smoke.mjs",
    "scripts/release-smoke.mjs",
    "scripts/verify-windows.ps1",
    "src/App.tsx",
  ]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), path);
    files.push({ path, sha256: digest(path) });
  }
  await mkdir(join(root, "verification-input"));
  const binary = Buffer.from("synthetic bytes; never executed");
  await writeFile(join(root, "verification-input/pavane.exe"), binary);
  const manifest = {
    schemaVersion: 1,
    mode: "prebuilt-ui",
    revision: "a".repeat(40),
    files,
    sourceSha256: digest(JSON.stringify(files)),
    binary: { bytes: binary.length, sha256: digest(binary) },
  };
  const save = () =>
    writeFile(
      join(root, "verification-input/manifest.json"),
      JSON.stringify(manifest),
    );
  await save();
  return { root, manifest, save };
}

test("prebuilt verification works without Git metadata or Rust", async (t) => {
  const { root } = await fixture(t);
  const result = await verifyPrebuilt(root);
  assert.equal(result.manifest.revision, "a".repeat(40));
  assert.equal(result.executable, join(root, "verification-input/pavane.exe"));
});

test("transported binary and source tampering fail closed", async (t) => {
  const { root } = await fixture(t);
  const executable = join(root, "verification-input/pavane.exe");
  const bytes = await readFile(executable);
  await writeFile(executable, Buffer.alloc(bytes.length));
  await assert.rejects(verifyPrebuilt(root), /Binary hash mismatch/);
  await writeFile(executable, bytes);
  await writeFile(join(root, "src/App.tsx"), "changed after build");
  await assert.rejects(verifyPrebuilt(root), /Transported source differs/);
});

test("unsafe paths, duplicate entries and missing required harnesses are rejected", async (t) => {
  for (const path of [
    "../secret",
    "scripts/../secret",
    "C:/secret",
    "scripts\\x",
    "/src/x",
    "src//x",
    "verification-input/pavane.exe",
  ])
    assert.equal(sourcePath(path), false, path);
  const { root, manifest, save } = await fixture(t);
  manifest.files.push(manifest.files[0]);
  await save();
  await assert.rejects(verifyPrebuilt(root), /Duplicate/);
  manifest.files.pop();
  manifest.files = manifest.files.filter(
    (file) => file.path !== "scripts/native-smoke.mjs",
  );
  await save();
  await assert.rejects(verifyPrebuilt(root), /Manifest is missing/);
});
