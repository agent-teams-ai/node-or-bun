import { spawnSync } from "node:child_process";
import { delimiter, resolve } from "node:path";
import { existsSync } from "node:fs";

/** Resolve the consumer's qualified runtime, independently of optional tool bins. */
export function bunRuntime(): string {
  const executable = process.platform === "win32" ? "bun.exe" : "bun";
  const explicit = process.env.BUN_BIN;
  const candidates =
    explicit === undefined
      ? (process.env.PATH ?? "")
          .split(delimiter)
          .filter((entry) => !entry.replaceAll("\\", "/").endsWith("/node_modules/.bin"))
          .map((entry) => resolve(entry, executable))
          .filter(existsSync)
      : [explicit];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim() === "1.4.3") {
      return candidate;
    }
  }
  throw new Error("Bun 1.4.3 runtime unavailable; provide BUN_BIN or a qualified runtime on PATH");
}
