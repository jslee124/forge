import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { DesktopApplication } from "./application.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "forge-readiness-"));
  roots.push(root);
  const home = join(root, "home");
  await mkdir(home);
  return { home, app: new DesktopApplication({ FORGE_HOME: home }, root) };
}
it("detects missing credentials without creating a session or granting authority", async () => {
  const { app } = await fixture();
  const result = await app.manage({
    type: "check-readiness",
    engine: "native",
  });
  expect(result.readiness).toEqual({
    ready: false,
    issue: "missing_credentials",
  });
  expect(result.sessionId).toBe("");
  expect(result.sessions).toEqual([]);
  expect(result.permissionGrants).toEqual([]);
});
it("rechecks current configuration and supports explicitly unauthenticated local routes", async () => {
  const { app, home } = await fixture();
  expect(
    (await app.manage({ type: "check-readiness", engine: "native" })).readiness
      ?.ready,
  ).toBe(false);
  await writeFile(
    join(home, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      model: { provider: "local", id: "fixture" },
      providers: {
        local: {
          api: "openai-completions",
          baseUrl: "http://127.0.0.1:1/v1",
          auth: { type: "none" },
          models: [{ id: "fixture" }],
        },
      },
    }),
  );
  const result = await app.manage({
    type: "check-readiness",
    engine: "native",
  });
  // No server listens here: readiness is local validation, not a connection probe.
  expect(result.readiness).toEqual({ ready: true });
  expect(result.sessions).toEqual([]);
});
it("does not reuse credentials stored for a different endpoint", async () => {
  const { app, home } = await fixture();
  const config = (baseUrl: string) => ({
    schemaVersion: 1,
    model: { provider: "route", id: "fixture" },
    providers: {
      route: {
        api: "openai-completions",
        baseUrl,
        auth: { type: "bearer" },
        models: [{ id: "fixture" }],
      },
    },
  });
  await writeFile(
    join(home, "config.json"),
    JSON.stringify(config("http://127.0.0.1:1/v1")),
  );
  await app.manage({
    type: "native-login",
    provider: "route",
    apiKey: "test-only-key",
  });
  expect(
    (await app.manage({ type: "check-readiness", engine: "native" })).readiness
      ?.ready,
  ).toBe(true);
  await writeFile(
    join(home, "config.json"),
    JSON.stringify(config("http://127.0.0.1:2/v1")),
  );
  expect(
    (await app.manage({ type: "check-readiness", engine: "native" })).readiness,
  ).toEqual({ ready: false, issue: "missing_credentials" });
});
it("rejects unsupported model settings without leaking parser details", async () => {
  const { app, home } = await fixture();
  await writeFile(
    join(home, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      model: { provider: "local", id: "fixture" },
      providers: {
        local: {
          api: "openai-completions",
          baseUrl: "http://127.0.0.1:1/v1",
          auth: { type: "none" },
          models: [{ id: "fixture" }],
        },
      },
    }),
  );
  const result = await app.manage({
    type: "check-readiness",
    engine: "native",
    selection: { engine: "native", provider: "unknown", model: "fixture" },
  });
  expect(result.readiness).toEqual({
    ready: false,
    issue: "invalid_configuration",
  });
  expect(result.sessions).toEqual([]);
});
