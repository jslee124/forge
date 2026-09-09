import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAppServerClient } from "@forge/codex-app-server";
import { FileSessionStore } from "@forge/persistence";
import { expect, it } from "vitest";
import { DesktopApplication } from "./application.js";

const { FORGE_DESKTOP_LIVE_CODEX } = process.env;
it.skipIf(FORGE_DESKTOP_LIVE_CODEX !== "1")(
  "uses local Codex authentication for two real turns, restart and confirmed interruption",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-d08-live-"));
    const env = { ...process.env, FORGE_HOME: join(root, "home") };
    let controller = new AbortController();
    let interruptOnStart = false;
    let confirmedInterrupt = false;
    const connect = async () => {
      const client = await CodexAppServerClient.connect({ env, cwd: root });
      const request = client.request.bind(client);
      client.request = async <T>(
        method: string,
        params?: unknown,
      ): Promise<T> => {
        const result = await request<T>(method, params);
        if (method === "turn/start" && interruptOnStart) controller.abort();
        return result;
      };
      client.onNotification((event) => {
        if (
          event.method === "turn/completed" &&
          (event.params as { turn?: { status?: string } }).turn?.status ===
            "interrupted"
        )
          confirmedInterrupt = true;
      });
      return client;
    };
    let app = new DesktopApplication(env, root, { connect });
    const hardStop = setTimeout(() => {
      controller.abort();
      app.close();
    }, 150_000);
    try {
      const auth = await app.manage({ type: "auth-status" });
      expect(auth.auth).toBe("authenticated");
      expect(auth.codexModels.length).toBeGreaterThan(0);
      const state = await app.manage({
        type: "create",
        prompt: "Codex live acceptance",
      });
      const execute = async (prompt: string) => {
        let text = "";
        const outcome = await app.execute(
          {
            type: "start",
            sessionId: state.sessionId,
            requestId: randomUUID(),
            runId: randomUUID(),
            engine: "codex",
            prompt,
          },
          {
            signal: controller.signal,
            text: (value) => {
              text += value;
            },
            detail: () => undefined,
            approve: async () => false,
          },
        );
        return { outcome, text };
      };
      const first = await execute(
        'Create only d08-proof.txt in your working directory containing exactly "D08 first\\n". Read it to verify. Remember the marker CEDAR-582. Reply briefly with that marker. Do not access other files or the network.',
      );
      expect(first.outcome).toBe("completed");
      expect(first.text).toContain("CEDAR-582");
      expect(await readFile(join(state.cwd, "d08-proof.txt"), "utf8")).toBe(
        "D08 first\n",
      );
      app.close();
      app = new DesktopApplication(env, root, { connect });
      await app.manage({ type: "resume", sessionId: state.sessionId });
      const second = await execute(
        'Read d08-proof.txt and append exactly "D08 resumed\\n" to it. Reply with the marker from our previous turn. Only access that file.',
      );
      expect(second.outcome).toBe("completed");
      expect(second.text).toContain("CEDAR-582");
      expect(await readFile(join(state.cwd, "d08-proof.txt"), "utf8")).toBe(
        "D08 first\nD08 resumed\n",
      );
      controller = new AbortController();
      interruptOnStart = true;
      const cancelled = await execute(
        "Explain how you would verify the file without using any tools. Do not modify anything.",
      );
      expect(cancelled.outcome).toBe("cancelled");
      expect(confirmedInterrupt).toBe(true);
      const snapshot = await new FileSessionStore(env.FORGE_HOME).load(
        state.sessionId,
      );
      expect(snapshot.lastEngine).toBe("codex");
      expect(snapshot.history.some((m) => m.role === "tool")).toBe(false);
      expect(snapshot.lastRunStatus).toBe("cancelled");
    } finally {
      clearTimeout(hardStop);
      controller.abort();
      app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  180_000,
);
