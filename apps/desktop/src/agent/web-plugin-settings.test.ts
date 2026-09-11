import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { WebPluginSettings } from "./web-plugin-settings.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "forge-web-settings-"));
  roots.push(cwd);
  const home = join(cwd, "home");
  const source = join(cwd, "bundle");
  await cp(
    fileURLToPath(
      new URL("../../../../examples/plugins/web-tools", import.meta.url),
    ),
    source,
    { recursive: true },
  );
  return {
    cwd,
    home,
    source,
    settings: new WebPluginSettings(
      { FORGE_HOME: home, FORGE_WEB_PLUGIN_ROOT: source },
      cwd,
    ),
  };
}
it("installs explicitly, preserves config, configures and survives restart without secrets in state", async () => {
  const f = await fixture();
  expect(await f.settings.state()).toMatchObject({
    installed: false,
    enabled: false,
    provider: "auto",
    actualProvider: "duckduckgo",
  });
  await f.settings.manage({ type: "web-install" });
  expect(await f.settings.state()).toMatchObject({
    installed: true,
    enabled: false,
  });
  await writeFile(
    join(f.home, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      plugins: { enabled: ["existing"] },
      model: { id: "preserve" },
    }),
  );
  await f.settings.manage({ type: "web-enable", enabled: true });
  await f.settings.manage({ type: "web-configure", provider: "brave" });
  const restarted = new WebPluginSettings(
    { FORGE_HOME: f.home, BRAVE_SEARCH_API_KEY: "test-secret" },
    f.cwd,
  );
  expect(await restarted.state()).toMatchObject({
    installed: true,
    enabled: true,
    provider: "brave",
    actualProvider: "brave",
    braveKeyConfigured: true,
  });
  expect(JSON.stringify(await restarted.state())).not.toContain("test-secret");
  await restarted.manage({ type: "web-enable", enabled: false });
  expect(
    JSON.parse(await readFile(join(f.home, "config.json"), "utf8")),
  ).toEqual({
    schemaVersion: 1,
    plugins: { enabled: ["existing"] },
    model: { id: "preserve" },
  });
  await expect(f.settings.manage({ type: "web-install" })).rejects.toThrow(
    "web-plugin-exists",
  );
});
it("rejects missing bundles, enable-before-install and symlink settings writes", async () => {
  const f = await fixture();
  await expect(
    f.settings.manage({ type: "web-enable", enabled: true }),
  ).rejects.toThrow("web-plugin-missing");
  await expect(
    new WebPluginSettings({ FORGE_HOME: f.home }, f.cwd).manage({
      type: "web-install",
    }),
  ).rejects.toThrow("web-bundle-unavailable");
  await mkdir(join(f.home, "plugins"), { recursive: true });
  await symlink(f.source, join(f.home, "plugins", "web-tools"));
  await expect(
    f.settings.manage({ type: "web-configure", provider: "duckduckgo" }),
  ).rejects.toThrow("web-settings-invalid");
});

it("repairs invalid local settings without blocking desktop state", async () => {
  const f = await fixture();
  await f.settings.manage({ type: "web-install" });
  await writeFile(
    join(f.home, "plugins", "web-tools", "settings.json"),
    "invalid",
  );
  expect(await f.settings.state()).toMatchObject({
    configurationInvalid: true,
  });
  await f.settings.manage({ type: "web-configure", provider: "duckduckgo" });
  expect(await f.settings.state()).toMatchObject({
    configurationInvalid: false,
    provider: "duckduckgo",
  });
});
