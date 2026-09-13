import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const artifact = resolve(
  process.argv[2] ?? "release/forge-desktop-0.3.4-arm64.dmg",
);
const evidence = resolve("qa/d13", basename(artifact));
await mkdir(evidence, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "forge-d13-install-"));
const home = join(root, "home");
const volume = join(root, "volume");
const installed = join(root, "Applications");
await Promise.all([mkdir(home), mkdir(volume), mkdir(installed)]);
const run = (command, args) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out`));
    }, 120000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolveRun() : reject(new Error(`${command}: ${code}`));
    });
  });
let mounted = false;
try {
  if (artifact.endsWith(".app")) {
    await run("/usr/bin/ditto", [
      artifact,
      join(installed, "Forge Desktop.app"),
    ]);
  } else if (artifact.endsWith(".dmg")) {
    await run("/usr/bin/hdiutil", [
      "attach",
      artifact,
      "-readonly",
      "-nobrowse",
      "-mountpoint",
      volume,
    ]);
    mounted = true;
    await run("/usr/bin/ditto", [
      join(volume, "Forge Desktop.app"),
      join(installed, "Forge Desktop.app"),
    ]);
    await run("/usr/bin/hdiutil", ["detach", volume]);
    mounted = false;
  } else {
    await run("/usr/bin/ditto", ["-x", "-k", artifact, installed]);
  }
  await run("/usr/bin/open", [
    "-n",
    "-W",
    "--stdout",
    join(root, "stdout.log"),
    "--stderr",
    join(root, "stderr.log"),
    "--env",
    "PATH=/usr/bin:/bin:/usr/sbin:/sbin",
    "--env",
    `FORGE_HOME=${home}`,
    "--env",
    `FORGE_D13_INSTALL_HOME=${home}`,
    "--env",
    "HTTPS_PROXY=",
    "--env",
    "HTTP_PROXY=",
    "--env",
    "https_proxy=",
    "--env",
    "http_proxy=",
    join(installed, "Forge Desktop.app"),
    "--args",
    "--desktop-install-smoke",
  ]);
  const result = JSON.parse(
    await readFile(join(home, "installed.json"), "utf8"),
  );
  if (
    !result.agentShutdown ||
    result.path !== "/usr/bin:/bin:/usr/sbin:/sbin" ||
    result.proxyConfigured
  )
    throw new Error("Unexpected launch environment or shutdown");
  try {
    process.kill(result.agentPid, 0);
    throw new Error("Agent survived application exit");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  await writeFile(
    join(evidence, "installed.json"),
    `${JSON.stringify({ ...result, launch: "LaunchServices open, explicit clean PATH/proxy and isolated FORGE_HOME", artifact: basename(artifact), agentExited: true }, null, 2)}\n`,
  );
  await copyFile(
    join(home, "installed-pdf.png"),
    join(evidence, "installed-pdf.png"),
  );
  console.log(`Installed acceptance passed: ${evidence}`);
} catch (error) {
  console.error(
    await readFile(join(root, "stderr.log"), "utf8").catch(() => "No app log"),
  );
  throw error;
} finally {
  if (mounted) await run("/usr/bin/hdiutil", ["detach", volume]);
  await rm(root, { recursive: true, force: true });
}
