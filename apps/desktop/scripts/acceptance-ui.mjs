import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const home = await mkdtemp(join(tmpdir(), "forge-d12-ui-"));
try {
  const child = spawn(
    require("electron"),
    [resolve("."), "--desktop-acceptance"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        FORGE_HOME: home,
        FORGE_D12_UI_HOME: home,
        FORGE_D12_UI_OUTPUT: resolve("qa/d12/ui"),
      },
    },
  );
  const timer = setTimeout(() => child.kill(), 90000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    if (code !== 0) throw new Error(`Desktop acceptance failed: ${code}`);
  } finally {
    clearTimeout(timer);
  }
} finally {
  await rm(home, { recursive: true, force: true });
}
