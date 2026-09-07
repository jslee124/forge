import { createAgentRequestHandler } from "./runtime.js";

const parentPort = process.parentPort;
if (!parentPort) {
  throw new Error(
    "Forge Desktop Agent must be started as an Electron utility process",
  );
}

const handleRequest = createAgentRequestHandler({
  // biome-ignore lint/complexity/useLiteralKeys: ProcessEnv is index-signature-only under strict TypeScript.
  resourceRoot: process.env["FORGE_DESKTOP_RESOURCE_ROOT"],
  send: (message) => parentPort.postMessage(message),
  exit: () => setImmediate(() => process.exit(0)),
});

parentPort.on("message", (event) => {
  void handleRequest(event.data);
});
parentPort.postMessage({ type: "ready", pid: process.pid });
