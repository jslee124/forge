import { configureHttpDispatcher } from "@forge/application";
import { z } from "zod";
import { managementCommandSchema } from "../shared/application-protocol.js";
import { DesktopApplication, desktopError } from "./application.js";
import { RunService } from "./run-service.js";
import { createAgentRequestHandler } from "./runtime.js";

const parentPort = process.parentPort;
if (!parentPort) {
  throw new Error(
    "Forge Desktop Agent must be started as an Electron utility process",
  );
}

configureHttpDispatcher(process.env);

const application = new DesktopApplication(process.env, process.cwd());
const runs = new RunService(
  (message) => parentPort.postMessage(message),
  application.execute,
);
const managementSchema = z
  .object({
    type: z.literal("management"),
    requestId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    command: managementCommandSchema,
  })
  .strict();
let management = Promise.resolve();

const handleRequest = createAgentRequestHandler({
  // biome-ignore lint/complexity/useLiteralKeys: ProcessEnv is index-signature-only under strict TypeScript.
  resourceRoot: process.env["FORGE_DESKTOP_RESOURCE_ROOT"],
  send: (message) => parentPort.postMessage(message),
  exit: () => {
    runs.close();
    application.close();
    void runs.drain().finally(() => process.exit(0));
  },
});

parentPort.on("message", (event) => {
  const parsed = managementSchema.safeParse(event.data);
  if (parsed.success) {
    const { requestId, command } = parsed.data;
    management = management.then(async () => {
      try {
        if (
          runs.busy &&
          command.type !== "state" &&
          command.type !== "cancel-login"
        )
          throw new Error("busy");
        const state = await application.manage(command);
        parentPort.postMessage({ type: "management-reply", requestId, state });
      } catch (error) {
        parentPort.postMessage({
          type: "management-reply",
          requestId,
          error: desktopError(error),
        });
      }
    });
    return;
  }
  runs.handle(event.data);
  void handleRequest(event.data);
});
parentPort.postMessage({ type: "ready", pid: process.pid });
