// Explicit opt-in acceptance: downloads the official existing DMG and opens it;
// never replaces Applications, launches the downloaded app, or publishes a release.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, shell } from "electron";
import { createUpdateFetch } from "../src/main/update-network.ts";
import { UpdateService } from "../src/main/update-service.ts";

if (!process.argv.includes("--live"))
  throw new Error("Requires explicit --live");
async function run() {
  await app.whenReady();
  let quitRequested = false;
  app.on("before-quit", () => {
    quitRequested = true;
  });
  let exitCode = 0;
  const root = await mkdtemp(join(tmpdir(), "forge-update-live-"));
  const fixtureIndex = process.argv.indexOf("--release-fixture");
  const fixture =
    fixtureIndex >= 0
      ? JSON.parse(await readFile(process.argv[fixtureIndex + 1], "utf8"))
      : undefined;
  const liveFetch = createUpdateFetch();
  const service = new UpdateService({
    root,
    version: "0.3.4-preview.0",
    arch: process.arch,
    startupAllowed: false,
    fetch: (url, options) =>
      fixture && String(url).startsWith("https://api.github.com/")
        ? Promise.resolve(Response.json(fixture))
        : liveFetch(url, options),
    openPath: (path) => shell.openPath(path),
  });
  try {
    await service.initialize();
    let result = await service.command({ type: "check" });
    console.log("Live update check", result);
    if (result.phase !== "available")
      throw new Error(result.error ?? "No compatible live release");
    result = await service.command({ type: "download" });
    if (result.phase !== "verified")
      throw new Error(result.error ?? "Download failed");
    const directory = (await readdir(root)).find((name) =>
      name.startsWith("session-"),
    );
    const folder = join(root, directory);
    const name = (await readdir(folder)).find((name) => name.endsWith(".dmg"));
    const path = join(folder, name);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    const digest = hash.digest("hex");
    result = await service.command({ type: "open" });
    if (result.phase !== "verified")
      throw new Error(result.error ?? "Open failed");
    const evidence = {
      date: new Date().toISOString(),
      releaseEnumeration: fixture
        ? "captured official metadata fixture; asset downloads are live"
        : "live unauthenticated API",
      fixtureCurrentVersion: "0.3.4-preview.0",
      target: result.target,
      arch: process.arch,
      source: `https://github.com/jslee124/forge/releases/download/desktop-${result.target}/${name}`,
      sha256: digest,
      openPathSucceeded: true,
      processStillRunningAfterOpen: !quitRequested,
      replacementPerformed: false,
      root,
    };
    await writeFile(
      join(root, "evidence.json"),
      JSON.stringify(evidence, null, 2),
    );
    console.log(await readFile(join(root, "evidence.json"), "utf8"));
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    // The mounted image is left for inspection/ejection; do not remove its backing file here.
    app.exit(exitCode);
  }
}
void run().catch((error) => {
  console.error(error);
  app.exit(1);
});
