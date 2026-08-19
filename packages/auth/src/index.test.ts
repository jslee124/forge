import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AuthenticationManager, AuthenticationStoreError } from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("AuthenticationManager", () => {
  it("resolves environment variables before stored credentials", async () => {
    const forgeHome = await createForgeHome();
    const stored = new AuthenticationManager({ FORGE_HOME: forgeHome });
    await stored.storeApiKey("deepseek", "stored-secret");

    const manager = new AuthenticationManager({
      FORGE_HOME: forgeHome,
      DEEPSEEK_API_KEY: " environment-secret ",
    });
    expect(manager.requireApiKey("deepseek")).toMatchObject({
      apiKey: "environment-secret",
      source: "environment",
    });
  });

  it("stores multiple providers atomically with owner-only permissions", async () => {
    const forgeHome = await createForgeHome();
    const manager = new AuthenticationManager({ FORGE_HOME: forgeHome });
    await Promise.all([
      manager.storeApiKey("deepseek", "deepseek-secret"),
      manager.storeApiKey("openai", "openai-secret"),
    ]);

    expect(manager.requireApiKey("deepseek")).toMatchObject({
      apiKey: "deepseek-secret",
      source: "stored",
    });
    expect(manager.requireApiKey("openai")).toMatchObject({
      apiKey: "openai-secret",
      source: "stored",
    });
    expect((await stat(forgeHome)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(forgeHome, "auth.json"))).mode & 0o777).toBe(
      0o600,
    );
  });

  it("removes only the selected stored credential", async () => {
    const forgeHome = await createForgeHome();
    const manager = new AuthenticationManager({ FORGE_HOME: forgeHome });
    await manager.storeApiKey("deepseek", "deepseek-secret");
    await manager.storeApiKey("openai", "openai-secret");

    expect(await manager.removeStoredApiKey("deepseek")).toBe(true);
    expect(manager.status("deepseek").authenticated).toBe(false);
    expect(manager.status("openai").source).toBe("stored");
  });

  it("does not overwrite a corrupt credential file", async () => {
    const forgeHome = await createForgeHome();
    const authPath = path.join(forgeHome, "auth.json");
    await writeFile(authPath, "not json", "utf8");
    const manager = new AuthenticationManager({ FORGE_HOME: forgeHome });

    await expect(
      manager.storeApiKey("deepseek", "new-secret"),
    ).rejects.toBeInstanceOf(AuthenticationStoreError);
    expect(await readFile(authPath, "utf8")).toBe("not json");
  });

  it("explains that ChatGPT subscription access is a different path", async () => {
    const forgeHome = await createForgeHome();
    expect(() =>
      new AuthenticationManager({ FORGE_HOME: forgeHome }).requireApiKey(
        "openai",
      ),
    ).toThrow(/forge codex.*subscription access/iu);
  });

  it("stores and resolves a credential for a third-party route", async () => {
    const forgeHome = await createForgeHome();
    const manager = new AuthenticationManager({ FORGE_HOME: forgeHome });

    await manager.storeApiKey("my-gateway", "route-secret");

    expect(manager.status("my-gateway").authenticated).toBe(true);
    expect(manager.requireApiKey("my-gateway").apiKey).toBe("route-secret");
    // A route without a declared variable gets one derived from its name.
    expect(manager.status("my-gateway").environmentVariable).toBe(
      "FORGE_MY_GATEWAY_API_KEY",
    );
    // Built-in credentials are unaffected by the generalization.
    expect(manager.status("deepseek").authenticated).toBe(false);
  });

  it("prefers the environment variable a route profile declares", async () => {
    const forgeHome = await createForgeHome();
    const manager = new AuthenticationManager({
      FORGE_HOME: forgeHome,
      MY_GATEWAY_TOKEN: "from-environment",
    });
    await manager.storeApiKey("my-gateway", "stored-secret");

    const declared = { environmentVariable: "MY_GATEWAY_TOKEN" };
    expect(manager.status("my-gateway", declared).source).toBe("environment");
    expect(manager.requireApiKey("my-gateway", declared).apiKey).toBe(
      "from-environment",
    );
    // Without the declaration the stored credential still answers.
    expect(manager.requireApiKey("my-gateway").apiKey).toBe("stored-secret");
  });

  it("refuses a credential name that is not a usable route", async () => {
    const forgeHome = await createForgeHome();
    const manager = new AuthenticationManager({ FORGE_HOME: forgeHome });

    await expect(
      manager.storeApiKey("__proto__", "secret"),
    ).rejects.toBeInstanceOf(AuthenticationStoreError);
    await expect(
      manager.storeApiKey("Has Spaces", "secret"),
    ).rejects.toBeInstanceOf(AuthenticationStoreError);
  });

  it("skips an unusable stored entry instead of failing every credential", async () => {
    const forgeHome = await createForgeHome();
    const authPath = path.join(forgeHome, "auth.json");
    await writeFile(
      authPath,
      `{"version":1,"credentials":{"__proto__":{"type":"api_key","key":"ignored"},"deepseek":{"type":"api_key","key":"kept"}}}`,
      "utf8",
    );
    const manager = new AuthenticationManager({ FORGE_HOME: forgeHome });

    expect(manager.requireApiKey("deepseek").apiKey).toBe("kept");
    expect(manager.status("__proto__").authenticated).toBe(false);
  });
});

async function createForgeHome(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "forge-auth-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
