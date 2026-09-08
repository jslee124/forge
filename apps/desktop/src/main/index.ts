import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  utilityProcess,
} from "electron";
import {
  CHOOSE_WORKSPACE_CHANNEL,
  MANAGEMENT_CHANNEL,
  managementCommandSchema,
  OPEN_LOGIN_CHANNEL,
} from "../shared/application-protocol.js";
import {
  AGENT_PING_CHANNEL,
  RUN_COMMAND_CHANNEL,
  RUN_EVENT_CHANNEL,
} from "../shared/desktop-api.js";
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
  mainWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  await loadRenderer(window);
  return window;
}

async function shutdown(): Promise<void> {
  if (quitting) return;
  quitting = true;
  ipcMain.removeHandler(AGENT_PING_CHANNEL);
  ipcMain.removeHandler(RUN_COMMAND_CHANNEL);
  for (const channel of [
    MANAGEMENT_CHANNEL,
    CHOOSE_WORKSPACE_CHANNEL,
    OPEN_LOGIN_CHANNEL,
  ])
    ipcMain.removeHandler(channel);
  await agent?.close();
  agent = undefined;
}

async function run(): Promise<void> {
  await app.whenReady();
  agent = startAgent();
  await agent.waitUntilReady();
  ipcMain.handle(AGENT_PING_CHANNEL, (event) => {
    if (
      event.sender !== mainWindow?.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    )
      throw new Error("Invalid sender");
    return agent?.ping();
  });
  ipcMain.handle(RUN_COMMAND_CHANNEL, (event, value: unknown) => {
    if (
      event.sender !== mainWindow?.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    )
      return false;
    return agent?.runs.request(value) ?? false;
  });
  ipcMain.handle(MANAGEMENT_CHANNEL, (event, value: unknown) => {
    if (
      event.sender !== mainWindow?.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    )
      throw new Error("Invalid sender");
    const command = managementCommandSchema.parse(value);
    if (command.type === "workspace") throw new Error("Use directory picker");
    return agent?.management.request(command);
  });
  ipcMain.handle(CHOOSE_WORKSPACE_CHANNEL, async (event) => {
    if (
      event.sender !== mainWindow?.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    )
      throw new Error("Invalid sender");
    const selection = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
    });
    const cwd = selection.filePaths[0];
    return !cwd || selection.canceled
      ? null
      : agent?.management.request({ type: "workspace", cwd });
  });
  ipcMain.handle(OPEN_LOGIN_CHANNEL, async (event) => {
    if (
      event.sender !== mainWindow?.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    )
      throw new Error("Invalid sender");
    const state = await agent?.management.request({ type: "state" });
    if (!state?.loginUrl) return;
    const url = new URL(state.loginUrl);
    if (
      url.protocol !== "https:" ||
      !["auth.openai.com", "chatgpt.com", "auth0.openai.com"].includes(
        url.hostname,
      )
    )
      throw new Error("Invalid login URL");
    await shell.openExternal(url.toString());
  });
  agent.runs.subscribe((event) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send(RUN_EVENT_CHANNEL, event);
  });

  if (process.argv.includes("--desktop-smoke")) {
    const health = await agent.ping();
    if (!health.resourcesAvailable) {
      throw new Error(
        "Desktop Agent could not locate packaged Forge resources",
      );
    }
    const smokeWindow = await createWindow(false);
    const state = await smokeWindow.webContents.executeJavaScript(
      "window.forgeDesktop.manage({type: 'state'})",
    );
    if (!state || typeof state.forgeHome !== "string")
      throw new Error("Desktop preload/application bridge unavailable");
    await smokeWindow.webContents.executeJavaScript("document.fonts.ready");
    await smokeWindow.webContents.executeJavaScript(
      "new Promise(resolve => setTimeout(resolve, 100))",
    );
    const screenshot = await smokeWindow.webContents.capturePage();
    await writeFile(
      join(app.getPath("temp"), "forge-desktop-d07.png"),
      screenshot.toPNG(),
    );
    await smokeWindow.webContents.executeJavaScript(
      "document.querySelector('[data-testid=settings]').click()",
    );
    await smokeWindow.webContents.executeJavaScript(
      "new Promise(resolve => setTimeout(resolve, 50))",
    );
    await smokeWindow.webContents.executeJavaScript(
      "const language = document.querySelector('[data-testid=language]'); language.value = 'en'; language.dispatchEvent(new Event('change', {bubbles: true}));",
    );
    await smokeWindow.webContents.executeJavaScript(
      "new Promise(resolve => setTimeout(resolve, 50))",
    );
    const english = await smokeWindow.webContents.capturePage();
    await writeFile(
      join(app.getPath("temp"), "forge-desktop-d08-settings.png"),
      english.toPNG(),
    );
    const overflow = await smokeWindow.webContents.executeJavaScript(
      "document.documentElement.scrollWidth > window.innerWidth",
    );
    if (overflow) throw new Error("Desktop layout overflows horizontally");
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
