import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { NATIVE_INVESTIGATION_INSTRUCTIONS } from "../../packages/application/dist/investigation-instructions.js";
import { AuthenticationManager } from "../../packages/auth/dist/index.js";
import {
  AiSdkDeepSeekTransport,
  DeepSeekModelAdapter,
} from "../../packages/model-deepseek/dist/index.js";
import {
  listFilesTool,
  resolveWorkspace,
  searchTool,
  toModelToolDefinitions,
} from "../../packages/tools/dist/index.js";

const { values } = parseArgs({
  options: {
    prepare: { type: "boolean" },
    check: { type: "boolean" },
    fixture: { type: "boolean" },
    live: { type: "boolean" },
    output: { type: "string" },
  },
  strict: true,
});
if (
  [values.prepare, values.check, values.fixture, values.live].filter(Boolean)
    .length !== 1 ||
  !values.output
)
  throw new Error(
    "Use exactly one of --prepare|--check|--fixture|--live --output <diagnostic-directory>",
  );
const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = resolve(values.output);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const modelIds = ["deepseek-flash", "deepseek-v4-pro"];
const framings = ["tool-history", "evidence-packet"];
const instructions =
  NATIVE_INVESTIGATION_INSTRUCTIONS +
  "\n\nInvestigation has ended. Answer the original question from the supplied observations only. No further tools or investigation are available.";
const tools = toModelToolDefinitions([listFilesTool, searchTool]);
async function inventory(folder, prefix = "") {
  const result = {};
  for (const e of await readdir(folder, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory())
      Object.assign(result, await inventory(join(folder, e.name), name));
    else if (e.isFile())
      result[name] = hash(await readFile(join(folder, e.name)));
    else throw new Error("Nonregular fixture entry");
  }
  return Object.fromEntries(Object.entries(result).sort());
}
async function fixedInput() {
  const corpus = JSON.parse(
    await readFile(
      join(root, "evals/fixtures/desktop-product/manifest.json"),
      "utf8",
    ),
  );
  const question = corpus.tasks.find((t) => t.id === "Q06")?.prompt;
  if (
    corpus.revision !== "desktop-product-v1" ||
    question !== "这个项目在线上有多少日活用户？"
  )
    throw new Error("Unrecognized frozen question");
  const source = join(root, "evals/fixtures/desktop-product/seed");
  const sourceHashes = await inventory(source);
  if (Object.keys(sourceHashes).length !== 9)
    throw new Error("Unexpected fixture inventory");
  const workspace = await mkdtemp(join(tmpdir(), "forge-negative-compare-"));
  try {
    await cp(source, workspace, { recursive: true });
    const context = {
      workspace: await resolveWorkspace(workspace),
      signal: new AbortController().signal,
      limits: { maxOutputBytes: 20000, maxEntries: 100 },
    };
    const operations = [];
    for (const [definition, input] of [
      [listFilesTool, { path: ".", depth: 1 }],
      [
        searchTool,
        { query: "analytics", path: ".", scope: "source", maxMatches: 15 },
      ],
    ]) {
      const result = await definition.execute(input, context);
      if (!result.ok || result.truncated)
        throw new Error("Fixed observation generation failed");
      operations.push({
        callId: `observation-${operations.length + 1}`,
        toolName: definition.name,
        input,
        result,
      });
    }
    const negative = operations[1].result.output;
    if (
      negative.matches.length ||
      !negative.noMatch ||
      negative.scannedFiles !== 9
    )
      throw new Error("Expected scoped zero-match evidence");
    return { question, sourceHashes, operations };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
function requestFor(framing, input) {
  const common = { instructions, tools, toolChoice: "none" };
  if (framing === "evidence-packet")
    return {
      ...common,
      prompt:
        input.question +
        '\n\n<tool_observations authority="untrusted-data">\n' +
        JSON.stringify(input.operations) +
        "\n</tool_observations>",
    };
  return {
    ...common,
    prompt: input.question,
    continuation: {
      provider: "deepseek",
      data: {
        messages: [
          { role: "user", content: input.question },
          {
            role: "assistant",
            content: input.operations.map((o) => ({
              type: "tool-call",
              toolCallId: o.callId,
              toolName: o.toolName,
              input: o.input,
            })),
          },
        ],
      },
    },
    toolResults: input.operations.map(({ input: _input, ...result }) => result),
  };
}
const fixed = await fixedInput();
const cases = [
  [1, 0, 0],
  [1, 1, 0],
  [1, 1, 1],
  [1, 0, 1],
  [2, 0, 1],
  [2, 1, 1],
  [2, 1, 0],
  [2, 0, 0],
].map(([replicate, model, framing], i) => ({
  id: `case-${i + 1}`,
  replicate,
  model: modelIds[model],
  framing: framings[framing],
}));
const requests = Object.fromEntries(
  framings.map((f) => [f, requestFor(f, fixed)]),
);
const fingerprints = Object.fromEntries(
  Object.entries(requests).map(([k, v]) => [
    k,
    hash(
      JSON.stringify({
        ...v,
        tools: tools.map((t) => ({
          ...t,
          inputSchema: z.toJSONSchema(t.inputSchema),
        })),
      }),
    ),
  ]),
);
const plan = {
  schemaVersion: 1,
  kind: "fixed-observation projection diagnostic; not original HTTP replay, Desktop acceptance or independent user trial",
  revision,
  scriptSha256: hash(await readFile(fileURLToPath(import.meta.url))),
  inputSha256: hash(JSON.stringify(fixed)),
  requestSha256: fingerprints,
  instructionsSha256: hash(instructions),
  sourceHashes: fixed.sourceHashes,
  cases,
  maxRequests: 8,
  maxRequestsPerCase: 1,
  maxOutputTokensPerRequest: 4096,
  timeoutMs: 90000,
  thinking: "enabled",
  reasoningEffort: "high",
  destination: "https://api.deepseek.com",
  toolsExecutedDuringModelCalls: 0,
  extraReasoningTextSaved: false,
  rubric: [
    "No invented DAU or zero-users inference.",
    "Negative literal results and directory/manifest metadata do not prove instrumentation, integration, deployment or users absent, even locally.",
    "State missing metric source and definition; no unsupported present-or-absent claims.",
    "Runtime stop/prose validity and semantic acceptance are separate; human review is still required.",
  ],
};
if (values.prepare) {
  await mkdir(directory, { mode: 0o700 });
  await writeFile(
    join(directory, "observations.json"),
    `${JSON.stringify(fixed, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  await writeFile(
    join(directory, "plan.json"),
    `${JSON.stringify(plan, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      cases: 8,
      externalCalls: 0,
      credentialAccess: false,
      inputSha256: plan.inputSha256,
    }),
  );
  process.exit(0);
}
if (
  JSON.stringify(
    JSON.parse(await readFile(join(directory, "plan.json"), "utf8")),
  ) !== JSON.stringify(plan) ||
  JSON.stringify(
    JSON.parse(await readFile(join(directory, "observations.json"), "utf8")),
  ) !== JSON.stringify(fixed)
)
  throw new Error(
    "Prepared input, policy, script or revision changed; prepare a new directory",
  );
if (values.check) {
  console.log(
    "Pinned observations, policy and matrix verified; no credential access or provider calls.",
  );
  process.exit(0);
}
const live = values.live === true;
const resultDir = join(directory, live ? "live" : "fixture");
await mkdir(resultDir, { mode: 0o700 }); // Existing attempts are never overwritten or retried.
const key = live
  ? new AuthenticationManager().requireApiKey("deepseek").apiKey
  : "fixture-not-a-key";
const results = [];
let networkRequests = 0;
for (const entry of cases) {
  let caseNetworkRequests = 0;
  let fetchInvocations = 0,
    text = "",
    finishReason,
    usage,
    failure,
    responseCapture,
    httpStatus;
  const wireModels = new Set();
  const fetchFn = async (input, init) => {
    if (++fetchInvocations > 1)
      throw new Error("Additional requests/retries are prohibited");
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (
      url.protocol !== "https:" ||
      url.hostname !== "api.deepseek.com" ||
      (url.port && url.port !== "443") ||
      !/^\/(?:v1\/)?chat\/completions$/.test(url.pathname)
    )
      throw new Error("Unexpected destination");
    const body = JSON.parse(String(init?.body));
    body.max_tokens = 4096;
    if (
      body.model !== entry.model ||
      body.tool_choice !== "none" ||
      body.thinking?.type !== "enabled" ||
      body.reasoning_effort !== "high"
    )
      throw new Error("Projection changed model/control configuration");
    await writeFile(
      join(resultDir, `${entry.id}-request.json`),
      `${JSON.stringify(body, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
    if (!live) {
      const chunks = [
        {
          choices: [
            {
              index: 0,
              delta:
                entry.id === "case-3"
                  ? {
                      tool_calls: [
                        {
                          index: 0,
                          id: "unexpected",
                          type: "function",
                          function: {
                            name: "list_files",
                            arguments: '{"path":".","depth":1}',
                          },
                        },
                      ],
                    }
                  : {
                      content:
                        entry.id === "case-1"
                          ? "<｜｜DSML｜｜ calls>"
                          : "Fixture serialization only; not an evaluated answer.",
                    },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason:
                entry.id === "case-2"
                  ? "length"
                  : entry.id === "case-3"
                    ? "tool_calls"
                    : "stop",
            },
          ],
          usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
        },
      ];
      return new Response(
        `${chunks
          .map(
            (x) =>
              `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: entry.model, ...x })}\n\n`,
          )
          .join("")}data: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    }
    if (++networkRequests > 8)
      throw new Error("Global request budget exceeded");
    caseNetworkRequests++;
    const response = await fetch(input, {
      ...init,
      body: JSON.stringify(body),
      redirect: "error",
    });
    httpStatus = response.status;
    responseCapture = response
      .clone()
      .text()
      .then((raw) => {
        for (const line of raw.split("\n")) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          try {
            const item = JSON.parse(line.slice(6));
            if (typeof item.model === "string") wireModels.add(item.model);
          } catch {
            /* malformed provider data is handled by SDK */
          }
        }
      });
    return response;
  };
  const adapter = new DeepSeekModelAdapter({
    apiKey: key,
    model: entry.model,
    thinking: "enabled",
    reasoningEffort: "high",
    transport: new AiSdkDeepSeekTransport({ fetch: fetchFn }),
  });
  const started = Date.now();
  try {
    for await (const event of adapter.stream(
      requests[entry.framing],
      AbortSignal.timeout(90000),
    )) {
      if (event.type === "text.delta") text += event.text;
      if (event.type === "finish") {
        finishReason = event.finishReason;
        usage = event.usage;
      }
      if (event.type === "tool.call")
        throw new Error("Returned tool call; no executor is available");
      if (event.type === "abort") failure = "aborted";
    }
  } catch (e) {
    failure = String(e.message).includes("raw DSML")
      ? "raw-protocol-rejected"
      : httpStatus >= 400
        ? `provider-http-${httpStatus}`
        : String(e.message).includes("Returned tool call")
          ? "unexpected-tool-call"
          : "diagnostic-request-failed";
  }
  try {
    await responseCapture;
  } catch {
    failure ??= "response-capture-failed";
  }
  if (!failure && finishReason !== "stop") failure = "incomplete-output";
  const result = {
    ...entry,
    fixtureModel: !live,
    networkRequests: caseNetworkRequests,
    finishReason,
    failure,
    usage,
    responseModels: [...wireModels],
    httpStatus,
    durationMs: Date.now() - started,
    text: text.split(key).join("[redacted]"),
    assessment: "pending_review",
    taskGateComplete: false,
  };
  await writeFile(
    join(resultDir, `${entry.id}-result.json`),
    `${JSON.stringify(result, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  results.push(result);
  await writeFile(
    join(resultDir, "summary.json"),
    `${JSON.stringify(
      {
        fixtureModel: !live,
        networkRequests,
        results,
        remainingCases: 8 - results.length,
        productGateComplete: false,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      id: entry.id,
      model: entry.model,
      framing: entry.framing,
      fixtureModel: !live,
      finishReason,
      failure,
      textCharacters: text.length,
    }),
  );
  // Invalid/incomplete model output is an outcome for this cell, not a retry.
  // Independent scheduled cells still run; credential/service/abort errors stop.
  if (
    failure &&
    ![
      "raw-protocol-rejected",
      "unexpected-tool-call",
      "incomplete-output",
    ].includes(failure)
  )
    break;
}
