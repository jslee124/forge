import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { FileSessionStore } from "@forge/persistence";
import { expect, it } from "vitest";
import { DesktopApplication } from "./application.js";

const { FORGE_DESKTOP_LIVE_DEEPSEEK, FORGE_HOME, DEEPSEEK_API_KEY } =
  process.env;

// Explicit opt-in only. Credentials stay in this process; temporary transcripts are removed.
it.skipIf(FORGE_DESKTOP_LIVE_DEEPSEEK !== "1")(
  "DeepSeek executes, resumes, denies and cancels desktop tool calls",
  async () => {
    const sourceHome = FORGE_HOME || join(homedir(), ".forge");
    let key = DEEPSEEK_API_KEY;
    if (!key) {
      const auth = JSON.parse(
        await readFile(join(sourceHome, "auth.json"), "utf8"),
      );
      key = auth.credentials?.deepseek?.key;
    }
    expect(Boolean(key), "DeepSeek credential is configured").toBe(true);
    const root = await mkdtemp(join(tmpdir(), "forge-d06-deepseek-"));
    const env = {
      ...process.env,
      FORGE_HOME: root,
      DEEPSEEK_API_KEY: key,
      FORGE_PROVIDER: "deepseek",
      FORGE_MODEL: "deepseek-v4-flash",
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150_000);
    const metrics: {
      approvals: number;
      textEvents: number;
      toolEvents: number;
      outcomes: string[];
    } = { approvals: 0, textEvents: 0, toolEvents: 0, outcomes: [] };
    let approvalMode: "allow" | "deny" | "cancel" = "allow";
    let app = new DesktopApplication(env, root);
    try {
      await writeFile(
        join(root, "config.json"),
        JSON.stringify({ schemaVersion: 1, limits: { maxSteps: 8 } }),
      );
      const state = await app.manage({
        type: "create",
        prompt: "D06 live acceptance",
      });
      const execute = async (prompt: string) => {
        const outcome = await app.execute(
          {
            type: "start",
            sessionId: state.sessionId,
            requestId: randomUUID(),
            runId: randomUUID(),
            engine: "native",
            prompt,
          },
          {
            signal: controller.signal,
            text: () => {
              metrics.textEvents++;
            },
            detail: (kind) => {
              if (kind === "tool") metrics.toolEvents++;
            },
            approve: async (description) => {
              metrics.approvals++;
              if (approvalMode === "cancel") controller.abort();
              if (approvalMode !== "allow") return false;
              // Only the scratch proof file and a read-only pwd command are authorized.
              return (
                description.includes('"path": "d06-proof.txt"') ||
                (description.includes('"program": "pwd"') &&
                  description.includes('"args": []'))
              );
            },
          },
        );
        metrics.outcomes.push(outcome ?? "missing");
        expect(outcome).toBe(
          approvalMode === "cancel" ? "cancelled" : "completed",
        );
      };
      await execute(
        'Use edit_file to create d06-proof.txt containing exactly "D06 first turn\\n". Then read_file that file and run_command with program pwd and args []. Do not use any other command or file. Reply briefly.',
      );
      expect(await readFile(join(state.cwd, "d06-proof.txt"), "utf8")).toBe(
        "D06 first turn\n",
      );
      app.close();
      app = new DesktopApplication(env, root);
      expect(
        (await app.state()).sessions.some((s) => s.id === state.sessionId),
      ).toBe(true);
      const restored = await app.manage({
        type: "resume",
        sessionId: state.sessionId,
      });
      expect(restored.cwd).toBe(state.cwd);
      await execute(
        'Continue the preceding task. Read d06-proof.txt, then use edit_file to replace its content with exactly "D06 first turn\\nD06 resumed turn\\n". Do not touch any other file or run any command. Reply briefly.',
      );
      expect(await readFile(join(state.cwd, "d06-proof.txt"), "utf8")).toBe(
        "D06 first turn\nD06 resumed turn\n",
      );
      const snapshot = await new FileSessionStore(root).load(state.sessionId);
      expect(snapshot.runIds).toHaveLength(2);
      const tools = snapshot.history.filter((m) => m.role === "tool");
      expect(tools.every((m) => !m.isError)).toBe(true);
      expect(tools.map((m) => m.toolName)).toEqual(
        expect.arrayContaining(["edit_file", "read_file", "run_command"]),
      );
      expect(metrics.approvals).toBeGreaterThanOrEqual(3);
      expect(metrics.textEvents).toBeGreaterThan(0);
      const approvalsBeforeDeny = metrics.approvals;
      approvalMode = "deny";
      await execute(
        'Use edit_file to create d07-denied.txt containing "denied". If approval is refused, stop and explain briefly; do not retry or use another tool.',
      );
      expect(metrics.approvals).toBeGreaterThan(approvalsBeforeDeny);
      await expect(
        readFile(join(state.cwd, "d07-denied.txt")),
      ).rejects.toThrow();
      approvalMode = "cancel";
      const approvalsBeforeCancel = metrics.approvals;
      await execute(
        'Use edit_file to create d07-cancelled.txt containing "cancelled". Do not use any other tool.',
      );
      expect(metrics.approvals).toBeGreaterThan(approvalsBeforeCancel);
      await expect(
        readFile(join(state.cwd, "d07-cancelled.txt")),
      ).rejects.toThrow();
      expect(
        (await new FileSessionStore(root).load(state.sessionId)).lastRunStatus,
      ).toBe("cancelled");
    } finally {
      clearTimeout(timer);
      controller.abort();
      app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  180_000,
);
