import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const hash = (value) => createHash("sha256").update(value).digest("hex");

// This describes the source at verification time, not an inferred build receipt.
export async function verificationContext(root, executable, profile) {
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
