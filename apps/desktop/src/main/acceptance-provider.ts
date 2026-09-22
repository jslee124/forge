import { createServer } from "node:http";

/** Loopback-only scripted transport for development acceptance, never provider evidence. */
export async function acceptanceProvider() {
  let mode: "approval" | "wait" | "error" = "approval";
  let calls = 0;
  const server = createServer(async (request, response) => {
    calls++;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString()) as {
      messages?: { role: string }[];
    };
    if (mode === "error") {
      response.writeHead(400, { "content-type": "application/json" });
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
    if (mode === "wait") {
      send({ content: "P4 offline fixture — waiting for cancellation." });
      return;
    }
    if (!input.messages?.some((m) => m.role === "tool")) {
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
    get calls() {
      return calls;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
