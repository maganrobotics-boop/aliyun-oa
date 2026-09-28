import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const result = spawnSync(process.execPath, [nextCli, "build", "--webpack"], {
  stdio: "inherit",
  env: {
    ...process.env,
    OA_RUNTIME: "aliyun",
    NEXT_TELEMETRY_DISABLED: "1",
  },
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
