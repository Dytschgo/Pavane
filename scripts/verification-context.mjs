import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyPrebuilt } from "./prebuilt-input.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");

// This describes the source at verification time, not an inferred build receipt.
export async function verificationContext(root, executable, profile) {
  if (process.env.PAVANE_PREBUILT_VERIFICATION === "1") {
    const { manifest, executable: pinned } = await verifyPrebuilt(root);
    if (executable !== pinned)
      throw new Error("Unexpected prebuilt executable");
    return {
      capturedAt: new Date().toISOString(),
      revision: manifest.revision,
      mode: "prebuilt-ui",
      sourceManifestSha256: manifest.sourceSha256,
      sourceFiles: manifest.files.length,
      executable: { profile, ...manifest.binary },
      buildRust: manifest.buildRust,
      buildNode: manifest.buildNode,
      ci: manifest.ci ?? null,
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      note: "Transported source/binary hashes checked. Build ran on the build machine. Rust tests are excluded from this UI-test run; consult separate CI/local test evidence.",
    };
  }
  const command = (program, args) =>
    execFileSync(program, args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  const files = command("git", [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    "src",
    "src-tauri",
    "crates",
    "scripts",
    "package.json",
    "pnpm-lock.yaml",
    "Cargo.toml",
    "Cargo.lock",
    "vite.config.ts",
    "tsconfig.json",
  ])
    .split("\0")
    .filter(Boolean)
    .sort();
  const manifest = await Promise.all(
    files.map(
      async (file) => `${file}\0${hash(await readFile(join(root, file)))}\0`,
    ),
  );
  const binary = await readFile(executable);
  return {
    capturedAt: new Date().toISOString(),
    revision: command("git", ["rev-parse", "HEAD"]),
    workingTreeDirty: Boolean(command("git", ["status", "--porcelain"])),
    sourceManifestSha256: hash(manifest.join("")),
    sourceFiles: files.length,
    lockfiles: {
      pnpm: hash(await readFile(join(root, "pnpm-lock.yaml"))),
      cargo: hash(await readFile(join(root, "Cargo.lock"))),
    },
    executable: { profile, bytes: binary.length, sha256: hash(binary) },
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    rust: command("rustc", ["--version"]),
  };
}
