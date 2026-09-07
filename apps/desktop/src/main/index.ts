import { join, resolve } from "node:path";
import { app, BrowserWindow, ipcMain, utilityProcess } from "electron";
import { AGENT_PING_CHANNEL } from "../shared/desktop-api.js";
import { AgentProcess } from "./agent-process.js";

let agent: AgentProcess | undefined;
let mainWindow: BrowserWindow | undefined;
let quitting = false;

function agentEntry(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "agent", "index.js")
    : join(import.meta.dirname, "agent.js");
}

function resourceRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "forge-resources")
    : resolve(app.getAppPath(), "../../packages/resources");
}

function startAgent(): AgentProcess {
  const child = utilityProcess.fork(agentEntry(), [], {
    env: { ...process.env, FORGE_DESKTOP_RESOURCE_ROOT: resourceRoot() },
    serviceName: "Forge Desktop Agent",
  });
  return new AgentProcess(child);
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  // biome-ignore lint/complexity/useLiteralKeys: ProcessEnv is index-signature-only under strict TypeScript.
  const developmentUrl = process.env["ELECTRON_RENDERER_URL"];
  if (developmentUrl) {
    await window.loadURL(developmentUrl);
  } else {
    await window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
}

async function createWindow(show = true): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    show,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await loadRenderer(window);
  return window;
}

async function shutdown(): Promise<void> {
  if (quitting) return;
  quitting = true;
  ipcMain.removeHandler(AGENT_PING_CHANNEL);
  await agent?.close();
  agent = undefined;
}

async function run(): Promise<void> {
  await app.whenReady();
  agent = startAgent();
  await agent.waitUntilReady();
  ipcMain.handle(AGENT_PING_CHANNEL, () => agent?.ping());

  if (process.argv.includes("--desktop-smoke")) {
    const health = await agent.ping();
    if (!health.resourcesAvailable) {
      throw new Error(
        "Desktop Agent could not locate packaged Forge resources",
      );
    }
    const smokeWindow = await createWindow(false);
    smokeWindow.destroy();
    await shutdown();
    app.exit(0);
    return;
  }

  mainWindow = await createWindow();
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  void shutdown().finally(() => app.quit());
});

void run().catch((error: unknown) => {
  console.error(error);
  void shutdown().finally(() => app.exit(1));
});
