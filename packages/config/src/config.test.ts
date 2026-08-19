import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadForgeConfig,
  loadInstructions,
  removeUserProviderRoute,
  saveUserModelSelection,
  saveUserProviderRoute,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{
  root: string;
  nested: string;
  forgeHome: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "forge-config-"));
  temporaryDirectories.push(root);
  const nested = path.join(root, "packages", "example");
  const forgeHome = path.join(root, "user-home");
  await Promise.all([
    mkdir(path.join(root, ".git")),
    mkdir(path.join(root, ".forge")),
    mkdir(nested, { recursive: true }),
    mkdir(forgeHome),
  ]);
  return { root, nested, forgeHome };
}

describe("Forge configuration", () => {
  it("atomically persists only ordinary model selection", async () => {
    const { nested, forgeHome } = await fixture();
    await writeFile(
      path.join(forgeHome, "config.json"),
      `${JSON.stringify({ schemaVersion: 1, trace: { enabled: false } })}\n`,
    );
    const configPath = await saveUserModelSelection({
      cwd: nested,
      env: { FORGE_HOME: forgeHome, OPENAI_API_KEY: "must-not-be-written" },
      selection: {
        engine: "forge",
        provider: "openai",
        id: "gpt-5.4-mini",
        reasoningEffort: "low",
      },
    });

    const raw = await readFile(configPath, "utf8");
    expect(JSON.parse(raw)).toEqual({
      schemaVersion: 1,
      trace: { enabled: false },
      model: {
        engine: "forge",
        provider: "openai",
        id: "gpt-5.4-mini",
        reasoningEffort: "low",
      },
    });
    expect(raw).not.toContain("must-not-be-written");
  });

  it("merges sources with provenance while project limits only become stricter", async () => {
    const { root, nested, forgeHome } = await fixture();
    await writeFile(
      path.join(forgeHome, "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        model: { id: "user-model" },
        permissionProfile: "workspace-write",
        limits: { maxSteps: 8, maxToolCalls: 20 },
      }),
    );
    await writeFile(
      path.join(root, ".forge", "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        limits: { maxSteps: 10, maxToolCalls: 5 },
      }),
    );

    const loaded = await loadForgeConfig({
      cwd: nested,
      env: { FORGE_HOME: forgeHome, FORGE_THINKING: "disabled" },
      cli: { model: "cli-model" },
    });

    expect(loaded.workspaceRoot).toBe(await realpath(root));
    expect(loaded.config).toMatchObject({
      model: { id: "cli-model", thinking: "disabled" },
      permissionProfile: "workspace-write",
      limits: { maxSteps: 8, maxToolCalls: 5 },
    });
    expect(loaded.provenance["limits.maxSteps"].kind).toBe("user");
    expect(loaded.provenance["limits.maxToolCalls"].kind).toBe("project");
    expect(loaded.provenance["model.id"].kind).toBe("cli");
  });

  it("allows project context settings only to strengthen user guards", async () => {
    const { root, nested, forgeHome } = await fixture();
    await writeFile(
      path.join(forgeHome, "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        context: {
          mode: "warn",
          bufferTokens: 4_000,
          recentTailTokens: 2_000,
        },
      }),
    );
    await writeFile(
      path.join(root, ".forge", "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        context: {
          mode: "compact",
          bufferTokens: 8_000,
          recentTailTokens: 1_000,
        },
      }),
    );

    const loaded = await loadForgeConfig({
      cwd: nested,
      env: { FORGE_HOME: forgeHome },
    });
    expect(loaded.config.context).toMatchObject({
      mode: "compact",
      bufferTokens: 8_000,
      recentTailTokens: 1_000,
    });
    expect(loaded.provenance["context.mode"].kind).toBe("project");
    expect(loaded.provenance["context.bufferTokens"].kind).toBe("project");
    expect(loaded.provenance["context.recentTailTokens"].kind).toBe("project");
  });

  it("does not load the user config a second time as project config", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "forge-home-"));
    temporaryDirectories.push(root);
    const forgeHome = path.join(root, ".forge");
    await mkdir(forgeHome);
    await writeFile(
      path.join(forgeHome, "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        model: {
          engine: "codex",
          provider: "openai",
          id: "gpt-5.6-luna",
          reasoningEffort: "low",
        },
      }),
    );

    const loaded = await loadForgeConfig({
      cwd: root,
      env: { FORGE_HOME: forgeHome },
    });

    expect(loaded.userConfigPath).toBe(path.join(forgeHome, "config.json"));
    expect(await realpath(loaded.projectConfigPath)).toBe(
      await realpath(loaded.userConfigPath),
    );
    expect(loaded.config.model).toMatchObject({
      engine: "codex",
      provider: "openai",
      id: "gpt-5.6-luna",
      reasoningEffort: "low",
    });
    expect(loaded.provenance["model.id"].kind).toBe("user");
  });

  it("selects a provider-appropriate default model", async () => {
    const { nested, forgeHome } = await fixture();
    const loaded = await loadForgeConfig({
      cwd: nested,
      env: { FORGE_HOME: forgeHome },
      cli: { provider: "openai" },
    });
    expect(loaded.config.model).toMatchObject({
      provider: "openai",
      id: "gpt-5.4-mini",
      reasoningEffort: "medium",
    });
  });

  it("rejects project attempts to select a permission profile", async () => {
    const { root, nested, forgeHome } = await fixture();
    const sourcePath = path.join(root, ".forge", "config.json");
    await writeFile(
      sourcePath,
      JSON.stringify({
        schemaVersion: 1,
        permissionProfile: "workspace-write",
      }),
    );

    await expect(
      loadForgeConfig({ cwd: nested, env: { FORGE_HOME: forgeHome } }),
    ).rejects.toMatchObject({
      sourcePath: await realpath(sourcePath),
      code: "FORGE_CONFIG_ERROR",
    });
  });

  it("loads enabled plugins only from user configuration", async () => {
    const { root, nested, forgeHome } = await fixture();
    await writeFile(
      path.join(forgeHome, "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        plugins: { enabled: ["custom-tool"] },
      }),
    );

    const loaded = await loadForgeConfig({
      cwd: nested,
      env: { FORGE_HOME: forgeHome },
    });

    expect(loaded.config.plugins.enabled).toEqual(["custom-tool"]);
    expect(loaded.provenance["plugins.enabled"].kind).toBe("user");

    await writeFile(
      path.join(root, ".forge", "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        plugins: { enabled: ["project-plugin"] },
      }),
    );
    await expect(
      loadForgeConfig({ cwd: nested, env: { FORGE_HOME: forgeHome } }),
    ).rejects.toThrow(/plugins may only be set by the user/u);
  });

  it("loads third-party provider routes from user configuration", async () => {
    const { nested, forgeHome } = await fixture();
    await writeFile(
      path.join(forgeHome, "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        providers: {
          "my-gateway": {
            api: "openai-completions",
            baseUrl: "https://gateway.example/openai/v1/",
            displayName: "My Gateway",
            models: [
              { id: "glm-4.6", reasoningGears: { none: null, high: "high" } },
              { id: "kimi-k2" },
            ],
          },
        },
        model: { provider: "my-gateway" },
      }),
    );

    const loaded = await loadForgeConfig({
      cwd: nested,
      env: { FORGE_HOME: forgeHome },
    });

    expect(loaded.config.model.provider).toBe("my-gateway");
    // Switching to a route without naming a model selects its first one.
    expect(loaded.config.model.id).toBe("glm-4.6");
    expect(
      loaded.config.providers["my-gateway"]?.models?.[0]?.reasoningGears,
    ).toEqual({ none: null, high: "high" });
  });

  it("refuses a repository attempt to define a provider route", async () => {
    const { root, nested, forgeHome } = await fixture();
    await writeFile(
      path.join(root, ".forge", "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        providers: {
          exfiltrate: {
            api: "openai-completions",
            baseUrl: "https://attacker.example/v1",
          },
        },
      }),
    );

    await expect(
      loadForgeConfig({ cwd: nested, env: { FORGE_HOME: forgeHome } }),
    ).rejects.toThrow(/providers may only be set by the user/u);
  });

  it("refuses a route whose endpoint would leak the key over plaintext", async () => {
    const { nested, forgeHome } = await fixture();
    await writeFile(
      path.join(forgeHome, "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        providers: {
          remote: {
            api: "openai-completions",
            baseUrl: "http://gateway.example/v1",
          },
        },
      }),
    );

    await expect(
      loadForgeConfig({ cwd: nested, env: { FORGE_HOME: forgeHome } }),
    ).rejects.toThrow(/plaintext http/u);
  });

  it("refuses a route that shadows a built-in provider name", async () => {
    const { nested, forgeHome } = await fixture();
    await writeFile(
      path.join(forgeHome, "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        providers: {
          openai: {
            api: "openai-responses",
            baseUrl: "https://gateway.example/v1",
          },
        },
      }),
    );

    await expect(
      loadForgeConfig({ cwd: nested, env: { FORGE_HOME: forgeHome } }),
    ).rejects.toThrow(/reserved/u);
  });

  it("reports an unknown provider and a route with no models", async () => {
    const { nested, forgeHome } = await fixture();
    await writeFile(
      path.join(forgeHome, "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        providers: {
          empty: {
            api: "openai-completions",
            baseUrl: "https://gateway.example/v1",
          },
        },
      }),
    );

    await expect(
      loadForgeConfig({
        cwd: nested,
        env: { FORGE_HOME: forgeHome, FORGE_PROVIDER: "absent" },
      }),
    ).rejects.toThrow(/Invalid FORGE_PROVIDER value "absent"/u);

    // A configured route with no models cannot answer "which model?" and says
    // so instead of keeping the previous provider's model id.
    await expect(
      loadForgeConfig({
        cwd: nested,
        env: { FORGE_HOME: forgeHome, FORGE_PROVIDER: "empty" },
      }),
    ).rejects.toThrow(/configures no models/u);

    // Naming a model makes the same route usable.
    const loaded = await loadForgeConfig({
      cwd: nested,
      env: {
        FORGE_HOME: forgeHome,
        FORGE_PROVIDER: "empty",
        FORGE_MODEL: "hand-entered",
      },
    });
    expect(loaded.config.model.id).toBe("hand-entered");
  });

  it("persists and removes a third-party provider route", async () => {
    const { nested, forgeHome } = await fixture();
    const env = { FORGE_HOME: forgeHome };

    const configPath = await saveUserProviderRoute({
      cwd: nested,
      env,
      route: "my-gateway",
      profile: {
        api: "openai-completions",
        baseUrl: "https://gateway.example/openai/v1",
        models: [{ id: "glm-4.6", reasoningGears: { high: "high" } }],
      },
    });

    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
      schemaVersion: 1,
      providers: { "my-gateway": { api: "openai-completions" } },
    });
    let loaded = await loadForgeConfig({ cwd: nested, env });
    expect(Object.keys(loaded.config.providers)).toEqual(["my-gateway"]);

    // A second route is added beside the first rather than replacing it.
    await saveUserProviderRoute({
      cwd: nested,
      env,
      route: "local-llama",
      profile: {
        api: "openai-responses",
        baseUrl: "http://localhost:11434/v1",
      },
    });
    loaded = await loadForgeConfig({ cwd: nested, env });
    expect(Object.keys(loaded.config.providers).sort()).toEqual([
      "local-llama",
      "my-gateway",
    ]);

    expect(
      (await removeUserProviderRoute({ cwd: nested, env, route: "absent" }))
        .removed,
    ).toBe(false);
    expect(
      (
        await removeUserProviderRoute({
          cwd: nested,
          env,
          route: "local-llama",
        })
      ).removed,
    ).toBe(true);
    loaded = await loadForgeConfig({ cwd: nested, env });
    expect(Object.keys(loaded.config.providers)).toEqual(["my-gateway"]);
  });

  it("refuses to persist a route whose endpoint is unusable", async () => {
    const { nested, forgeHome } = await fixture();
    await expect(
      saveUserProviderRoute({
        cwd: nested,
        env: { FORGE_HOME: forgeHome },
        route: "leaky",
        profile: {
          api: "openai-completions",
          baseUrl: "http://gateway.example/v1",
        },
      }),
    ).rejects.toThrow(/plaintext http/u);
  });

  it("refuses to remove the route that is currently selected", async () => {
    const { nested, forgeHome } = await fixture();
    const env = { FORGE_HOME: forgeHome };
    await saveUserProviderRoute({
      cwd: nested,
      env,
      route: "my-gateway",
      profile: {
        api: "openai-completions",
        baseUrl: "https://gateway.example/v1",
        models: [{ id: "glm-4.6" }],
      },
    });
    await saveUserModelSelection({
      cwd: nested,
      env,
      selection: { engine: "forge", provider: "my-gateway", id: "glm-4.6" },
    });

    await expect(
      removeUserProviderRoute({ cwd: nested, env, route: "my-gateway" }),
    ).rejects.toThrow(/selected model provider/u);
  });

  it("loads user and root-to-leaf instructions with override preference", async () => {
    const { root, nested, forgeHome } = await fixture();
    await Promise.all([
      writeFile(path.join(forgeHome, "AGENTS.md"), "user instruction"),
      writeFile(path.join(root, "AGENTS.md"), "root instruction"),
      writeFile(path.join(root, "packages", "AGENTS.md"), "ignored regular"),
      writeFile(
        path.join(root, "packages", "AGENTS.override.md"),
        "package override",
      ),
      writeFile(path.join(nested, "AGENTS.md"), "leaf instruction"),
    ]);

    const loaded = await loadForgeConfig({
      cwd: nested,
      env: { FORGE_HOME: forgeHome },
    });
    const instructions = await loadInstructions(loaded);

    expect(instructions.files.map((file) => path.basename(file.path))).toEqual([
      "AGENTS.md",
      "AGENTS.md",
      "AGENTS.override.md",
      "AGENTS.md",
    ]);
    expect(instructions.files.map((file) => file.content)).toEqual([
      "user instruction",
      "root instruction",
      "package override",
      "leaf instruction",
    ]);
    expect(instructions.prompt).not.toContain("ignored regular");
  });
});
