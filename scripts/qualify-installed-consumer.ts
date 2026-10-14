import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

type Runtime = "node" | "bun";

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
};

const runtimeArgument = argument("runtime");
const runtimes: Runtime[] =
  runtimeArgument === undefined ? ["node", "bun"] : [runtimeArgument === "bun" ? "bun" : "node"];
const archive = resolve(argument("archive") ?? ".worker-tmp/pack/agent-teams-process-runtime-0.1.0.tgz");

const runCommand = (
  command: string,
  args: readonly string[],
  cwd: string = process.cwd(),
): void => {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    cwd,
    env: {
      ...process.env,
      npm_config_cache: resolve(".worker-tmp/cache/npm"),
      npm_config_logs_dir: resolve(".worker-tmp/cache/npm-logs"),
      npm_config_update_notifier: "false",
    },
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.stdout.write(result.stdout);
    process.exit(result.status ?? 1);
  }
};

const npmArguments = (args: readonly string[]): [string, string[]] => {
  if (process.env.NPM_BIN) return [process.env.NPM_BIN, [...args]];
  if (process.env.npm_execpath) return [process.execPath, [process.env.npm_execpath, ...args]];
  return ["npm", [...args]];
};

const qualify = async (runtime: Runtime): Promise<void> => {
  const directory = await mkdtemp(join(resolve("sandbox"), `TEST-installed-${runtime}-`));
  try {
    await writeFile(
      join(directory, "package.json"),
      `${JSON.stringify({ name: `test-consumer-${runtime}`, private: true, type: "module" }, null, 2)}\n`,
      "utf8",
    );
    const adapter = runtime === "node" ? "node" : "bun";
    await writeFile(
      join(directory, "consumer.ts"),
      `import { createProcessExecutor } from "@agent-teams/process-runtime";
import { create${runtime === "node" ? "Node" : "Bun"}ProcessAdapter } from "@agent-teams/process-runtime/${adapter}";
const result = await createProcessExecutor(create${runtime === "node" ? "Node" : "Bun"}ProcessAdapter()).run({
  command: process.execPath,
  args: ["-e", "process.stdout.write('installed-ok')"],
  cwd: process.cwd(),
  environment: { CONSUMER: "1" },
});
if (result.stdout !== "installed-ok" || result.exitCode !== 0) {
  throw new Error("installed consumer execution failed");
}
`,
      "utf8",
    );
    await writeFile(
      join(directory, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2023",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            noEmit: true,
            types: [runtime === "node" ? "node" : "bun"],
          },
          include: ["consumer.ts"],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    if (runtime === "node") {
      const [command, args] = npmArguments([
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        "--omit=dev",
        archive,
      ]);
      runCommand(command, args, directory);
    } else {
      const bun = process.env.BUN_BIN ?? "bun";
      runCommand(bun, ["install", "--production", "--ignore-scripts", "--no-save", archive], directory);
    }

    const tsc = resolve("node_modules/typescript/bin/tsc");
    runCommand(process.execPath, [tsc, "-p", "tsconfig.json"], directory);
    if (runtime === "node") {
      runCommand(process.execPath, ["consumer.ts"], directory);
    } else {
      runCommand(process.env.BUN_BIN ?? "bun", ["consumer.ts"], directory);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

for (const runtime of runtimes) {
  await qualify(runtime);
}
process.stdout.write(`installed consumer qualification passed: ${runtimes.join(", ")}\n`);
