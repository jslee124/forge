import { createServer } from "node:http";

/** Loopback-only scripted transport for development acceptance, never provider evidence. */
export async function acceptanceProvider() {
  let mode:
    | "approval"
    | "wait"
    | "error"
    | "finalize"
    | "delivery"
    | "stream"
    | "error-auth"
    | "error-network"
    | "error-rate"
    | "error-server" = "approval";
  let textStream:
    | { append: (text: string) => void; finish: () => void }
    | undefined;
  let calls = 0;
  let noneRequests = 0;
  let toolFreeRequests = 0;
  const server = createServer(async (request, response) => {
    calls++;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString()) as {
      messages?: { role: string }[];
      tool_choice?: string;
      tools?: unknown[];
    };
    if (input.tool_choice === "none") noneRequests++;
    if (!input.tools?.length) toolFreeRequests++;
    if (mode === "error-network") {
      response.destroy();
      return;
    }
    if (["error", "error-auth", "error-rate", "error-server"].includes(mode)) {
      response.writeHead(
        mode === "error-auth"
          ? 401
          : mode === "error-rate"
            ? 429
            : mode === "error-server"
              ? 503
              : 400,
        { "content-type": "application/json" },
      );
      response.end(
        JSON.stringify({
          error: {
            message: "P4 offline fixture rejection",
            type: "invalid_request_error",
          },
        }),
      );
      return;
    }
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    const send = (delta: unknown, finish_reason: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({ id: "p4-offline", object: "chat.completion.chunk", created: 1, model: "offline", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    send({ role: "assistant" });
    if (mode === "delivery") {
      const count =
        input.messages?.filter((message) => message.role === "tool").length ??
        0;
      if (count < 2) {
        send({
          tool_calls: [
            {
              index: 0,
              id: `delivery-${count}`,
              type: "function",
              function:
                count === 0
                  ? {
                      name: "edit_file",
                      arguments: JSON.stringify({
                        operation: "create",
                        path: "delivery.txt",
                        content: "Recorded delivery fixture\n",
                      }),
                    }
                  : {
                      name: "run_command",
                      arguments: JSON.stringify({
                        program: "node",
                        args: [
                          "-e",
                          "process.stderr.write('Fixture verification failed\\n');process.exit(1)",
                        ],
                      }),
                    },
            },
          ],
        });
        send({}, "tool_calls");
      } else {
        send({
          content:
            "Fixture answer claims success; inspect recorded command outcomes.",
        });
        send({}, "stop");
      }
      response.end("data: [DONE]\n\n");
      return;
    }
    if (mode === "stream") {
      textStream = {
        append: (text) => send({ content: text }),
        finish: () => {
          send({}, "stop");
          response.end("data: [DONE]\n\n");
          textStream = undefined;
        },
      };
      response.once("close", () => {
        textStream = undefined;
      });
      send({ content: "T12 stream fixture start.\n\n" });
      return;
    }
    if (mode === "wait") {
      send({ content: "P4 offline fixture — waiting for cancellation." });
      return;
    }
    if (
      mode === "finalize" &&
      (input.tool_choice === "none" || !input.tools?.length)
    ) {
      send({ content: "Partial fixture summary based on observed tools." });
      send({}, "stop");
    } else if (mode === "finalize") {
      send({
        tool_calls: [
          {
            index: 0,
            id: "finalization-read",
            type: "function",
            function: {
              name: "read_file",
              arguments: JSON.stringify({ path: "sum.js" }),
            },
          },
        ],
      });
      send({}, "tool_calls");
    } else if (!input.messages?.some((m) => m.role === "tool")) {
      send({
        tool_calls: [
          {
            index: 0,
            id: "offline-pwd",
            type: "function",
            function: {
              name: "run_command",
              arguments: JSON.stringify({ program: "pwd", args: [] }),
            },
          },
        ],
      });
      send({}, "tool_calls");
    } else {
      send({ content: "P4 offline fixture completed after approval." });
      send({}, "stop");
    }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fixture-address");
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    setMode(value: typeof mode) {
      mode = value;
    },
    appendText(text: string) {
      if (!textStream) throw new Error("fixture-stream-not-active");
      textStream.append(text);
    },
    finishText() {
      if (!textStream) throw new Error("fixture-stream-not-active");
      textStream.finish();
    },
    get calls() {
      return calls;
    },
    get toolFreeRequests() {
      return toolFreeRequests;
    },
    get noneRequests() {
      return noneRequests;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
