import { packedFilename } from "./release-policy.ts";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const destination = resolve(process.env.PACK_DESTINATION ?? ".worker-tmp/pack");
await mkdir(destination, { recursive: true });

const npmInvocation = process.env.NPM_BIN
  ? [process.env.NPM_BIN]
  : process.env.npm_execpath
    ? [process.execPath, process.env.npm_execpath]
    : ["npm"];
const packed = spawnSync(
  npmInvocation[0] ?? "npm",
  [...npmInvocation.slice(1), "pack", "--json", "--pack-destination", destination],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: resolve(".cache/npm"),
      npm_config_logs_dir: resolve(".cache/npm-logs"),
      npm_config_update_notifier: "false",
    },
  },
);
if (packed.status !== 0) {
  process.stderr.write(packed.stderr);
  process.exit(packed.status ?? 1);
}
const filename = packedFilename(JSON.parse(packed.stdout));
if (filename === undefined) {
  process.stderr.write(packed.stdout);
  process.stderr.write(packed.stderr);
  throw new Error("npm pack did not report an archive filename");
}
const archive = resolve(destination, filename);
const bytes = await readFile(archive);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const sri = `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
await writeFile(
  resolve(destination, "artifact.json"),
  `${JSON.stringify({ archive, sha256, sri }, null, 2)}\n`,
  "utf8",
);
await writeFile(resolve(destination, "SHA256SUMS"), `${sha256}  ${filename}\n`, "utf8");
process.stdout.write(`${archive}\nsha256=${sha256}\nsri=${sri}\n`);
