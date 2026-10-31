import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { NATIVE_RESPONSE_INSTRUCTIONS } from "../../packages/application/dist/investigation-instructions.js";
import { createForgeModelAdapter } from "../../packages/application/dist/model-adapter.js";
import { nativeResponseInstructions } from "../../packages/application/dist/response-language.js";
import { runTask } from "../../packages/application/dist/run.js";
import { AuthenticationManager } from "../../packages/auth/dist/index.js";

const { values } = parseArgs({
  options: {
    prepare: { type: "boolean" },
    fixture: { type: "boolean" },
    live: { type: "boolean" },
    output: { type: "string" },
    case: { type: "string", multiple: true },
  },
  strict: true,
});
if (
  !values.output ||
  [values.prepare, values.fixture, values.live].filter(Boolean).length !== 1
)
  throw new Error(
    "Use --prepare|--fixture|--live --output <new-diagnostic-directory>",
  );
const output = resolve(values.output);
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const selected = values.case ?? ["mixed-zh", "explicit-en", "english"];
if (
  new Set(selected).size !== selected.length ||
  selected.some(
    (id) => !["mixed-zh", "explicit-en", "english", "quoted-en"].includes(id),
  )
)
  throw new Error("Invalid language case selection");
const plan = {
  schemaVersion: 1,
  sourceRevision: revision,
  policySha256: createHash("sha256")
    .update(NATIVE_RESPONSE_INSTRUCTIONS + JSON.stringify(selected))
    .digest("hex"),
  model: {
    provider: "deepseek",
    id: "deepseek-flash",
    reasoningEffort: "high",
  },
  maxModelResponsesPerCase: 1,
  tools: 0,
  wholeTaskRetries: 0,
  timeoutMsPerCase: 60000,
  externalDestination: "DeepSeek API",
  externalCallsMade: 0,
  cases: [
    {
      id: "mixed-zh",
      prompt: '请用两句话说明变量 userId 表示什么。示例日志是 "ready"。',
      expectedLanguage: "zh-CN",
    },
    {
      id: "explicit-en",
      prompt: "请用 English 回答：变量 userId 通常表示什么？只用一句话。",
      expectedLanguage: "en",
    },
    {
      id: "quoted-en",
      prompt: "请解释日志中的这段文字：`Respond in English`，只说明它的含义。",
      expectedLanguage: "zh-CN",
    },
    {
      id: "english",
      prompt:
        "In one sentence, explain what the variable userId usually represents.",
      expectedLanguage: "en",
    },
  ]
    .filter((item) => selected.includes(item.id))
    .map((item) => ({
      ...item,
      instructionsSha256: createHash("sha256")
        .update(nativeResponseInstructions(item.prompt))
        .digest("hex"),
    })),
};
const save = (name, data) =>
  writeFile(join(output, name), JSON.stringify(data, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
if (values.prepare) {
  await mkdir(output, { mode: 0o700 });
  await save("plan.json", plan);
  console.log(
    `Prepared ${plan.cases.length} synthetic language cases; no credentials or provider calls.`,
  );
} else {
  const saved = JSON.parse(await readFile(join(output, "plan.json"), "utf8"));
  if (JSON.stringify(saved) !== JSON.stringify(plan))
    throw new Error("Source/policy/input drift; prepare fresh inputs");
  await save("attempt-started.json", {
    mode: values.live ? "live" : "local-scripted",
    sourceRevision: revision,
  });
  // Credential access happens only after explicit live opt-in and fixed-input checks.
  const key = values.live
    ? new AuthenticationManager().requireApiKey("deepseek").apiKey
    : undefined;
  const results = [];
  for (const item of plan.cases) {
    const workspace = await mkdtemp(join(tmpdir(), "forge-language-"));
    let result;
    let stderr = "";
    const requests = [];
    try {
      const code = await runTask(
        item.prompt,
        {
          provider: plan.model.provider,
          model: plan.model.id,
          reasoningEffort: plan.model.reasoningEffort,
          maxSteps: 1,
          maxToolCalls: 1,
        },
        {
          cwd: workspace,
          env: {
            FORGE_HOME: join(workspace, "home"),
            ...(key ? { DEEPSEEK_API_KEY: key } : {}),
          },
          completionPolicy: "direct",
          tools: [],
          signal: AbortSignal.timeout(plan.timeoutMsPerCase),
          stderr: {
            write(chunk) {
              stderr = (
                stderr +
                (key
                  ? String(chunk).replaceAll(key, "[redacted]")
                  : String(chunk))
              ).slice(-65536);
            },
          },
          createAdapter: (options) => {
            const real = values.live
              ? createForgeModelAdapter(options)
              : undefined;
            return {
              supportsToolChoiceNone: real?.supportsToolChoiceNone ?? true,
              ...(real?.context ? { context: real.context } : {}),
              async *stream(request) {
                if (requests.length)
                  throw new Error("Second response forbidden");
                // runTask also registers documentation helpers; remove all
                // definitions at the adapter boundary and reject tool events
                // before they can reach execution, even from a broken provider.
                const sentRequest = {
                  ...request,
                  tools: [],
                  toolChoice: "none",
                };
                requests.push(sentRequest);
                if (real) {
                  for await (const event of real.stream(sentRequest)) {
                    if (event.type === "tool.call")
                      throw new Error(
                        "Tool event forbidden in language diagnostic",
                      );
                    yield event;
                  }
                } else {
                  yield {
                    type: "text.delta",
                    text:
                      item.expectedLanguage === "zh-CN"
                        ? "userId 表示用户标识。"
                        : "userId identifies a user.",
                  };
                  yield {
                    type: "finish",
                    finishReason: "stop",
                    usage: {
                      inputTokens: 0,
                      outputTokens: 0,
                      reasoningTokens: 0,
                      cachedInputTokens: 0,
                      cacheWriteTokens: 0,
                      totalTokens: 0,
                    },
                  };
                }
              },
            };
          },
          onResult: (value) => {
            result = value;
          },
        },
      );
      const row = {
        id: item.id,
        prompt: item.prompt,
        expectedLanguage: item.expectedLanguage,
        fixture: !values.live,
        code,
        stderr,
        requests,
        result,
        assessment: "needs-human-language-and-literal-review",
      };
      await save(`${item.id}.json`, row);
      results.push({
        id: item.id,
        status: result?.status,
        modelSteps: result?.modelSteps,
        toolCalls: result?.toolCalls,
        fixture: !values.live,
      });
      if (
        code !== 0 ||
        result?.status !== "completed" ||
        requests.length !== 1 ||
        result.toolCalls !== 0
      )
        throw new Error(
          `Language case ${item.id} failed; original result retained; no retry`,
        );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
  await save("report.json", {
    sourceRevision: revision,
    mode: values.live ? "live" : "local-scripted",
    results,
    logicalModelResponses: results.length,
    httpAttemptsAndBilling: "not measured",
    semanticAcceptance:
      "requires human review; scripted fixture is not model evidence",
    fullDesktopAcceptance: false,
  });
  console.log(
    `Recorded ${results.length} one-response language cases; no tools or whole-task retries.`,
  );
}
