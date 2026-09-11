import { randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { loadForgeConfig, setUserPluginEnabled } from "@forge/application";
import { z } from "zod";
import type {
  DesktopState,
  ManagementCommand,
} from "../shared/application-protocol.js";

const settingsSchema = z
  .object({ provider: z.enum(["auto", "brave", "duckduckgo"]) })
  .strict();
const provenance =
  "Forge web-tools 1.1.0 · Mozilla Readability 0.6.0 · jsdom 26.1.0";

/** Installs only the application-supplied plugin. Never downloads or enables code implicitly. */
export class WebPluginSettings {
  constructor(
    readonly env: NodeJS.ProcessEnv,
    readonly cwd: string,
  ) {}
  async state(): Promise<NonNullable<DesktopState["web"]>> {
    const loaded = await loadForgeConfig({ env: this.env, cwd: this.cwd });
    const directory = join(loaded.forgeHome, "plugins", "web-tools");
    const installed = await lstat(join(directory, "plugin.json"))
      .then((s) => s.isFile())
      .catch(() => false);
    let configurationInvalid = false;
    const settings = await readFile(join(directory, "settings.json"), "utf8")
      .then((text) => settingsSchema.parse(JSON.parse(text)))
      .catch((error) => {
        if (error.code === "ENOENT") return { provider: "auto" as const };
        configurationInvalid = true;
        return { provider: "auto" as const };
      });
    const { BRAVE_SEARCH_API_KEY } = this.env;
    const braveKeyConfigured = Boolean(BRAVE_SEARCH_API_KEY?.trim());
    return {
      installed,
      configurationInvalid,
      enabled: loaded.config.plugins.enabled.includes("web-tools"),
      provider: settings.provider,
      actualProvider:
        settings.provider === "auto"
          ? braveKeyConfigured
            ? "brave"
            : "duckduckgo"
          : settings.provider,
      braveKeyConfigured,
      provenance,
    };
  }
  async manage(command: ManagementCommand): Promise<void> {
    const loaded = await loadForgeConfig({ env: this.env, cwd: this.cwd });
    const parent = join(loaded.forgeHome, "plugins");
    const target = join(parent, "web-tools");
    if (command.type === "web-install") {
      const { FORGE_WEB_PLUGIN_ROOT: source } = this.env;
      if (!source) throw new Error("web-bundle-unavailable");
      await mkdir(parent, { recursive: true, mode: 0o700 });
      if (
        await lstat(target)
          .then(() => true)
          .catch((error) => {
            if (error.code === "ENOENT") return false;
            throw error;
          })
      )
        throw new Error("web-plugin-exists");
      const staging = join(parent, `.web-tools-${randomUUID()}`);
      try {
        await cp(source, staging, {
          recursive: true,
          dereference: true,
          errorOnExist: true,
        });
        const manifest = JSON.parse(
          await readFile(join(staging, "plugin.json"), "utf8"),
        );
        if (manifest.name !== "web-tools" || manifest.version !== "1.1.0")
          throw new Error("web-bundle-unavailable");
        await rename(staging, target);
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    } else if (command.type === "web-enable") {
      if (command.enabled && !(await this.state()).installed)
        throw new Error("web-plugin-missing");
      await setUserPluginEnabled({
        env: this.env,
        cwd: this.cwd,
        name: "web-tools",
        enabled: command.enabled,
      });
    } else if (command.type === "web-configure") {
      if (!(await this.state()).installed)
        throw new Error("web-plugin-missing");
      if ((await lstat(target)).isSymbolicLink())
        throw new Error("web-settings-invalid");
      const temporary = join(target, `.settings-${randomUUID()}`);
      try {
        await writeFile(
          temporary,
          JSON.stringify(settingsSchema.parse({ provider: command.provider })),
          { mode: 0o600, flag: "wx" },
        );
        await rename(temporary, join(target, "settings.json"));
      } finally {
        await rm(temporary, { force: true });
      }
    }
  }
}
