import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "dist", "npm", "forge");
const expected = JSON.parse(
  await readFile(path.join(packageRoot, "package.json"), "utf8"),
);
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "forge-package-"));

try {
  const packed = run(
    "npm",
    ["pack", "--json", "--pack-destination", temporaryRoot],
    packageRoot,
    {
      npm_config_cache: path.join(temporaryRoot, "npm-cache"),
    },
  );
  const packReport = JSON.parse(packed);
  const report = packReport[0];
  if (!report || report.id !== `${expected.name}@${expected.version}`) {
    throw new Error("npm pack returned an unexpected package identity.");
  }

  const files = new Set(report.files.map((entry) => entry.path));
  const allowedFiles = new Set([
    "package.json",
    "dist/index.js",
    "README.md",
    "LICENSE",
  ]);
  for (const required of allowedFiles) {
    if (!files.has(required))
      throw new Error(`Packed artifact is missing ${required}.`);
  }
  for (const file of files) {
    if (!allowedFiles.has(file)) {
      throw new Error(`Packed artifact contains an unexpected file: ${file}.`);
    }
  }

  const tarball = path.join(temporaryRoot, report.filename);
  const installRoot = path.join(temporaryRoot, "install");
  run(
    "npm",
    [
      "install",
      "--prefix",
      installRoot,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarball,
    ],
    temporaryRoot,
    { npm_config_cache: path.join(temporaryRoot, "npm-cache") },
  );

  const binName = process.platform === "win32" ? "forge.cmd" : "forge";
  const binPath = path.join(installRoot, "node_modules", ".bin", binName);
  if (process.platform !== "win32") {
    const executable = await stat(binPath);
    if ((executable.mode & 0o111) === 0) {
      throw new Error("The installed forge binary is not executable.");
    }
  }

  const smokeEnv = {
    FORGE_HOME: path.join(temporaryRoot, "forge-home"),
    FORGE_DISABLE_UPDATE_CHECK: "1",
  };
  const versionOutput = run(binPath, ["--version"], temporaryRoot, smokeEnv);
  if (versionOutput.trim() !== expected.version) {
    throw new Error(
      `Installed CLI reported ${versionOutput.trim()}; expected ${expected.version}.`,
    );
  }
  run(binPath, ["--help"], temporaryRoot, smokeEnv);
  run(binPath, ["config", "validate"], temporaryRoot, smokeEnv);

  console.log(
    `Verified packed install ${expected.name}@${expected.version} (${report.size} bytes).`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function run(command, args, cwd, environment = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...environment },
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}.\n${result.stderr}`,
    );
  }
  return result.stdout;
}
