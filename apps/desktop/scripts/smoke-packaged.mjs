import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const releaseRoot = new URL("../release/", import.meta.url);
const entries = await readdir(releaseRoot, { withFileTypes: true });
const platformDirectory = process.arch === "arm64" ? "mac-arm64" : "mac";
const unpacked = entries.find(
  (entry) => entry.isDirectory() && entry.name === platformDirectory,
);
if (!unpacked) {
  throw new Error(
    "electron-builder did not create a macOS application directory",
  );
}

const executable = join(
  fileURLToPath(releaseRoot),
  unpacked.name,
  "Forge Desktop.app",
  "Contents",
  "MacOS",
  "Forge Desktop",
);
const child = spawn(executable, ["--desktop-smoke"], { stdio: "inherit" });
const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", resolve);
});
if (exitCode !== 0) {
  throw new Error(
    `Packaged desktop smoke exited with code ${String(exitCode)}`,
  );
}
