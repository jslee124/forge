import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { configureHttpDispatcher } from "@forge/application";
import { expect, it } from "vitest";
import { FileService } from "../main/file-service.js";
import { DesktopApplication } from "./application.js";

const { FORGE_D12_LIVE, FORGE_D12_EVIDENCE_DIR } = process.env;
for (const engine of ["native", "codex"] as const) {
  it.skipIf(FORGE_D12_LIVE !== "1")(
    `${engine}: code review, local CSV and sourced report through real services`,
    async () => {
      const root = await mkdtemp(join(tmpdir(), `forge-d12-${engine}-`));
      const home = join(root, "home");
      const cwd = join(root, "workspace");
      await mkdir(cwd);
      const evidence = resolve(
        FORGE_D12_EVIDENCE_DIR ?? join(tmpdir(), "forge-d12-live"),
      );
      await mkdir(evidence, { recursive: true });
      const env = {
        ...process.env,
        FORGE_HOME: home,
        FORGE_WEB_PLUGIN_ROOT: resolve("apps/desktop/out/web-tools"),
      };
      if (engine === "native") {
        const { DEEPSEEK_API_KEY, FORGE_HOME } = process.env;
        const auth = DEEPSEEK_API_KEY
          ? undefined
          : JSON.parse(
              await readFile(
                join(FORGE_HOME || join(homedir(), ".forge"), "auth.json"),
                "utf8",
              ),
            );
        Object.assign(env, {
          DEEPSEEK_API_KEY:
            DEEPSEEK_API_KEY || auth?.credentials?.deepseek?.key,
          FORGE_PROVIDER: "deepseek",
          FORGE_MODEL: "deepseek-v4-flash",
        });
      }
      configureHttpDispatcher(env);
      const app = new DesktopApplication(env, cwd);
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
        app.close();
      }, 160_000);
      const before = "export function add(a, b) { return a - b; }\n";
      const expected = "export function add(a, b) { return a + b; }\n";
      await writeFile(join(cwd, "sum.js"), before);
      await writeFile(join(cwd, "input.csv"), "id,amount\n001,10\n002,20\n");
      const files = new FileService();
      await files.setWorkspace(cwd, "task-start");
      let answer = "";
      let approvals = 0;
      let toolEvents = 0;
      const result: Record<string, unknown> = {
        engine,
        locale: engine === "native" ? "zh-CN" : "en",
        observedAt: new Date().toISOString(),
        status: "started",
      };
      try {
        await mkdir(home, { recursive: true });
        await writeFile(
          join(home, "config.json"),
          JSON.stringify({ schemaVersion: 1, limits: { maxSteps: 16 } }),
        );
        await app.manage({ type: "workspace", cwd });
        if (engine === "native") {
          await app.manage({ type: "web-install" });
          await app.manage({ type: "web-enable", enabled: true });
          await app.manage({ type: "web-configure", provider: "duckduckgo" });
        } else
          expect((await app.manage({ type: "auth-status" })).auth).toBe(
            "authenticated",
          );
        const task = `Complete three checks in this scratch workspace. Read sum.js and fix subtraction to addition; its exact final content must be ${JSON.stringify(expected)}. Read input.csv, preserve IDs 001/002, and create output.csv containing exactly "id,amount\\n001,10\\n002,20\\nTOTAL,30\\n". Search the web for Mozilla Readability, then read https://example.com/ with a web tool. Write report.md under 150 words, linking only consulted sources and clearly distinguishing search snippets, fetched body, failed reads and truncation. Do not use shell networking, install dependencies, or access files outside this workspace. Use only sum.js, input.csv, output.csv and report.md. ${engine === "native" ? "请用简体中文回复并撰写报告。" : "Use English for the reply and report."}`;
        const state = await app.manage({ type: "create", prompt: task });
        const outcome = await app.execute(
          {
            type: "start",
            engine,
            sessionId: state.sessionId,
            runId: randomUUID(),
            requestId: randomUUID(),
            prompt: task,
          },
          {
            signal: controller.signal,
            text: (value) => {
              answer += value;
            },
            detail: (kind) => {
              if (kind === "tool") toolEvents++;
            },
            approve: async (description) => {
              approvals++;
              return (
                engine === "native" &&
                (description.includes("web_search") ||
                  description.includes("web_fetch") ||
                  (description.includes('"operation":') &&
                    ["sum.js", "output.csv", "report.md"].some((path) =>
                      description.includes(`"path": "${path}"`),
                    )))
              );
            },
          },
        );
        Object.assign(result, { outcome });
        expect(outcome).toBe("completed");
        const code = await readFile(join(cwd, "sum.js"), "utf8");
        expect(code).toBe(expected);
        const csv = await readFile(join(cwd, "output.csv"), "utf8");
        expect(csv.replaceAll("\r\n", "\n")).toBe(
          "id,amount\n001,10\n002,20\nTOTAL,30\n",
        );
        const report = await readFile(join(cwd, "report.md"), "utf8");
        expect(report).toContain("https://example.com/");
        const review = await files.review();
        expect(review.entries).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: "sum.js", status: "modified" }),
            expect.objectContaining({ path: "output.csv", status: "added" }),
            expect.objectContaining({ path: "report.md", status: "added" }),
          ]),
        );
        const csvPreview = await files.preview({
          path: "output.csv",
          rowStart: 1,
          rowEnd: 10,
        });
        expect(JSON.stringify(csvPreview)).toContain("001");
        const reportPreview = await files.preview({ path: "report.md" });
        expect(JSON.stringify(reportPreview)).toContain("https://example.com/");
        await files.saveAs("report.md", join(root, "export.md"), false);
        expect(await readFile(join(root, "export.md"), "utf8")).toBe(report);
        await writeFile(join(evidence, `${engine}-report.md`), report);
        await writeFile(join(evidence, `${engine}-output.csv`), csv);
        Object.assign(result, {
          status: "passed",
          approvals,
          toolEvents,
          codeBefore: before,
          codeAfter: code,
          codeSha256: createHash("sha256").update(code).digest("hex"),
          review,
          csvPreview: {
            kind: csvPreview.document.kind,
            truncated: csvPreview.truncated,
          },
          reportPreview: {
            kind: reportPreview.document.kind,
            truncated: reportPreview.truncated,
          },
          exportedCopyMatches: true,
          sourceEvidence:
            engine === "native"
              ? "native tool events plus model report"
              : "model report; bridge has no structured source fields",
        });
      } catch (error) {
        Object.assign(result, {
          status: "failed",
          approvals,
          toolEvents,
          failure: error instanceof Error ? error.name : "unknown",
        });
        throw error;
      } finally {
        Object.assign(result, { answerProduced: answer.length > 0 });
        await writeFile(
          join(evidence, `${engine}.json`),
          `${JSON.stringify(result, null, 2)}\n`,
        );
        clearTimeout(timer);
        controller.abort();
        app.close();
        await rm(root, { recursive: true, force: true });
      }
    },
    180_000,
  );
}
