import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export const inputDirectory = "verification-input";
export const sourcePath = (path) =>
  typeof path === "string" &&
  !path.split("/").some((part) => !part || part === "." || part === "..") &&
  !/[\\:]/.test(path) &&
  /^(src\/|src-tauri\/|crates\/|scripts\/|assets\/|(?:package\.json|pnpm-lock\.yaml|Cargo\.toml|Cargo\.lock|vite\.config\.ts|tsconfig\.json|index\.html)$)/.test(
    path,
  );

// This binds a trusted local build to transported files, not a signature or a
// sandbox. No executable path, command, environment or provider auth is supplied
// by the manifest. A mismatch fails before launching the fixed executable.
export async function verifyPrebuilt(root) {
  const manifestPath = join(root, inputDirectory, "manifest.json");
  assert.ok(
    (await stat(manifestPath)).size <= 128 * 1024,
    "Manifest too large",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.mode, "prebuilt-ui");
  assert.match(manifest.revision, /^[a-f0-9]{40}$/);
  assert.ok(
    Array.isArray(manifest.files) &&
      manifest.files.length > 0 &&
      manifest.files.length <= 256,
    "Invalid source manifest",
  );
  const paths = new Set();
  for (const file of manifest.files) {
    assert.ok(sourcePath(file.path), "Invalid manifest source path");
    assert.ok(!paths.has(file.path), "Duplicate manifest source path");
    paths.add(file.path);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.equal(
      digest(await readFile(join(root, file.path))),
      file.sha256,
      `Transported source differs: ${file.path}`,
    );
  }
  for (const required of [
    "package.json",
    "pnpm-lock.yaml",
    "Cargo.lock",
    "scripts/native-smoke.mjs",
    "scripts/release-smoke.mjs",
    "scripts/verify-windows.ps1",
  ])
    assert.ok(paths.has(required), `Manifest is missing ${required}`);
  assert.equal(digest(JSON.stringify(manifest.files)), manifest.sourceSha256);
  assert.match(manifest.binary.sha256, /^[a-f0-9]{64}$/);
  const executable = join(root, inputDirectory, "pavane.exe");
  const binary = await readFile(executable);
  assert.equal(binary.length, manifest.binary.bytes);
  assert.equal(digest(binary), manifest.binary.sha256, "Binary hash mismatch");
  return { manifest, executable };
}
