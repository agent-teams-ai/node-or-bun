import { rm } from "node:fs/promises";

await Promise.all([
  rm("dist", { recursive: true, force: true }),
  rm("dist-tests", { recursive: true, force: true }),
  rm(".worker-tmp/pack", { recursive: true, force: true }),
]);
