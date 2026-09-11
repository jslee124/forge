import { lstat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
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
  OPEN_SOURCE_CHANNEL,
  sourceUrlSchema,
} from "../shared/application-protocol.js";
import {
  AGENT_PING_CHANNEL,
  RUN_COMMAND_CHANNEL,
  RUN_EVENT_CHANNEL,
} from "../shared/desktop-api.js";
import {
  CHANGE_REVIEW_CHANNEL,
  FILE_IMPORT_CHANNEL,
  FILE_OPEN_CHANNEL,
  FILE_PREVIEW_CHANNEL,
  FILE_REVEAL_CHANNEL,
  FILE_SAVE_AS_CHANNEL,
  previewRequestSchema,
  relativeFilePathSchema,
} from "../shared/file-protocol.js";
import { runUiAcceptance } from "./acceptance-ui.js";
import { AgentProcess } from "./agent-process.js";
import { FileService } from "./file-service.js";

let agent: AgentProcess | undefined;
let mainWindow: BrowserWindow | undefined;
let quitting = false;
const files = new FileService();

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

function pdfResourceRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "pdfjs")
    : resolve(app.getAppPath(), "node_modules/pdfjs-dist");
}

function startAgent(): AgentProcess {
  const child = utilityProcess.fork(agentEntry(), [], {
    env: {
      ...process.env,
      FORGE_DESKTOP_RESOURCE_ROOT: resourceRoot(),
      FORGE_WEB_PLUGIN_ROOT: app.isPackaged
        ? join(process.resourcesPath, "web-tools")
        : resolve(app.getAppPath(), "out/web-tools"),
      FORGE_PDFJS_RESOURCE_ROOT: pdfResourceRoot(),
    },
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
    OPEN_SOURCE_CHANNEL,
    FILE_IMPORT_CHANNEL,
    FILE_PREVIEW_CHANNEL,
    FILE_SAVE_AS_CHANNEL,
    FILE_OPEN_CHANNEL,
    FILE_REVEAL_CHANNEL,
    CHANGE_REVIEW_CHANNEL,
  ])
    ipcMain.removeHandler(channel);
  await agent?.close();
  agent = undefined;
}

async function run(): Promise<void> {
  await app.whenReady();
  // Main-process previews use the same packaged PDF.js data as the Agent process.
  // biome-ignore lint/complexity/useLiteralKeys: ProcessEnv is index-signature-only under strict TypeScript.
  process.env["FORGE_PDFJS_RESOURCE_ROOT"] = pdfResourceRoot();
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
    return agent?.management.request(command).then(async (state) => {
      if ((command.type === "create" || command.type === "resume") && state.cwd)
        await files.setWorkspace(
          state.cwd,
          command.type === "create" ? "task-start" : "resume-time",
        );
      return state;
    });
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
    if (!cwd || selection.canceled) return null;
    const state = await agent?.management.request({ type: "workspace", cwd });
    if (state?.cwd) await files.setWorkspace(state.cwd, "workspace-selection");
    return state;
  });
  ipcMain.handle(OPEN_SOURCE_CHANNEL, async (event, value: unknown) => {
    assertMainSender(event);
    await shell.openExternal(sourceUrlSchema.parse(value));
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
  ipcMain.handle(FILE_IMPORT_CHANNEL, async (event) => {
    assertMainSender(event);
    const owner = requireMainWindow();
    const state = await agent?.management.request({ type: "state" });
    if (!state?.cwd) throw new Error("workspace-unavailable");
    const selection = await dialog.showOpenDialog(owner, {
      properties: ["openFile"],
      filters: [
        {
          name: "Supported files",
          extensions: [
            "md",
            "txt",
            "json",
            "yaml",
            "yml",
            "pdf",
            "csv",
            "tsv",
            "png",
            "jpg",
            "jpeg",
          ],
        },
        { name: "All files", extensions: ["*"] },
      ],
    });
    const source = selection.filePaths[0];
    if (!source || selection.canceled) return null;
    const target = join(state.cwd, basename(source));
    const conflict = await lstat(target).then(
      () => true,
      () => false,
    );
    let choice: "rename" | "overwrite" | "cancel" = "rename";
    if (conflict) {
      const response = await dialog.showMessageBox(owner, {
        type: "warning",
        message: `A file named ${basename(source)} already exists.`,
        detail:
          "Choose whether to replace it or add the external file as a renamed copy.",
        buttons: ["Add renamed copy", "Replace", "Cancel"],
        defaultId: 0,
        cancelId: 2,
      });
      choice =
        response.response === 0
          ? "rename"
          : response.response === 1
            ? "overwrite"
            : "cancel";
    }
    return files.importFile(source, choice);
  });
  ipcMain.handle(FILE_PREVIEW_CHANNEL, async (event, value: unknown) => {
    assertMainSender(event);
    return files.preview(previewRequestSchema.parse(value));
  });
  ipcMain.handle(FILE_SAVE_AS_CHANNEL, async (event, value: unknown) => {
    assertMainSender(event);
    const owner = requireMainWindow();
    const path = relativeFilePathSchema.parse(value);
    const source = await files.workspaceFile(path);
    const selection = await dialog.showSaveDialog(owner, {
      defaultPath: basename(source),
    });
    if (selection.canceled || !selection.filePath) return null;
    const destination = selection.filePath;
    const conflict = await lstat(destination).then(
      () => true,
      () => false,
    );
    let overwrite = false;
    if (conflict && resolve(destination) !== source) {
      const response = await dialog.showMessageBox(owner, {
        type: "warning",
        message: `Replace ${basename(destination)}?`,
        detail:
          "The existing destination will be replaced. The workspace original remains intact.",
        buttons: ["Replace", "Cancel"],
        defaultId: 1,
        cancelId: 1,
      });
      if (response.response !== 0) return null;
      overwrite = true;
    }
    return files.saveAs(path, destination, overwrite);
  });
  ipcMain.handle(FILE_OPEN_CHANNEL, async (event, value: unknown) => {
    assertMainSender(event);
    const error = await shell.openPath(
      await files.workspaceFile(relativeFilePathSchema.parse(value)),
    );
    if (error) throw new Error("open-failed");
  });
  ipcMain.handle(FILE_REVEAL_CHANNEL, async (event, value: unknown) => {
    assertMainSender(event);
    shell.showItemInFolder(
      await files.workspaceFile(relativeFilePathSchema.parse(value)),
    );
  });
  ipcMain.handle(CHANGE_REVIEW_CHANNEL, (event) => {
    assertMainSender(event);
    return files.review();
  });
  agent.runs.subscribe((event) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send(RUN_EVENT_CHANNEL, event);
  });

  if (process.argv.includes("--desktop-acceptance")) {
    const {
      FORGE_D12_UI_HOME: home,
      FORGE_D12_UI_OUTPUT: output,
      FORGE_HOME,
    } = process.env;
    if (!home || home !== FORGE_HOME || !output)
      throw new Error(
        "Acceptance requires an explicit isolated home and output",
      );
    const window = await createWindow(false);
    await runUiAcceptance(window, home, output);
    window.destroy();
    await shutdown();
    app.exit(0);
    return;
  }

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

function assertMainSender(event: Electron.IpcMainInvokeEvent): void {
  if (
    event.sender !== mainWindow?.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  )
    throw new Error("Invalid sender");
}

function requireMainWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed())
    throw new Error("window-unavailable");
  return mainWindow;
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
