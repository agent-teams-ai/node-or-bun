import { writeFileSync } from "node:fs";

const mode = process.argv[2] ?? "";
const value = process.argv[3] ?? "";

const write = (stream: NodeJS.WriteStream, valueToWrite: string | Uint8Array): Promise<void> =>
  new Promise((resolve, reject) => {
    stream.write(valueToWrite, (error) => (error ? reject(error) : resolve()));
  });

const main = async (): Promise<void> => {
  switch (mode) {
    case "echo":
      process.stdout.write(
        JSON.stringify({
          argv: process.argv.slice(2),
          cwd: process.cwd(),
          env: { EXACT: process.env.EXACT, INHERITED: process.env.INHERITED },
        }),
      );
      return;
    case "concurrent":
      for (let index = 0; index < 3; index += 1) {
        await write(process.stdout, `out-${index}`);
        await write(process.stderr, `err-${index}`);
      }
      return;
    case "exit":
      process.exitCode = Number(value);
      return;
    case "signal":
      process.kill(process.pid, "SIGTERM");
      return;
    case "split-utf8":
      await write(process.stdout, new Uint8Array([0x41, 0xc3]));
      await write(process.stdout, new Uint8Array([0xa9, 0x42]));
      return;
    case "invalid-utf8":
      await write(process.stdout, new Uint8Array([0xff]));
      return;
    case "overflow": {
      const bytes = new Uint8Array(4 * 1024 * 1024 + 1);
      await write(process.stdout, bytes);
      return;
    }
    case "limit":
      await write(process.stdout, new Uint8Array(4 * 1024 * 1024));
      return;
    case "late-overflow":
      await new Promise((resolve) => setTimeout(resolve, 75));
      await write(process.stdout, new Uint8Array(4 * 1024 * 1024 + 1));
      return;
    case "touch":
      writeFileSync(value, "x");
      return;
    case "slow":
      await new Promise((resolve) => setTimeout(resolve, 750));
      return;
    default:
      process.exitCode = 64;
  }
};

void main();
