import { contextBridge, ipcRenderer } from "electron";
import {
  CHOOSE_WORKSPACE_CHANNEL,
  desktopStateSchema,
  MANAGEMENT_CHANNEL,
  type ManagementCommand,
  OPEN_LOGIN_CHANNEL,
} from "../shared/application-protocol.js";
import {
  AGENT_PING_CHANNEL,
  type DesktopApi,
  RUN_COMMAND_CHANNEL,
  RUN_EVENT_CHANNEL,
} from "../shared/desktop-api.js";

import {
  parseRunEvent,
  type RunCommand,
  type RunEvent,
} from "../shared/run-protocol.js";

const desktopApi: DesktopApi = Object.freeze({
  versions: Object.freeze({
    electron: process.versions.electron ?? "unknown",
    chrome: process.versions.chrome ?? "unknown",
  }),
  runCommand: (command: RunCommand) =>
    ipcRenderer.invoke(RUN_COMMAND_CHANNEL, command),
  onRunEvent: (listener: (event: RunEvent) => void) => {
    const receive = (_event: unknown, value: unknown) => {
      const event = parseRunEvent(value);
      if (event) listener(event);
    };
    ipcRenderer.on(RUN_EVENT_CHANNEL, receive);
    return () => {
      ipcRenderer.removeListener(RUN_EVENT_CHANNEL, receive);
    };
  },
  manage: async (command: Exclude<ManagementCommand, { type: "workspace" }>) =>
    desktopStateSchema.parse(
      await ipcRenderer.invoke(MANAGEMENT_CHANNEL, command),
    ),
  chooseWorkspace: async () => {
    const value: unknown = await ipcRenderer.invoke(CHOOSE_WORKSPACE_CHANNEL);
    return value === null ? null : desktopStateSchema.parse(value);
  },
  openLogin: () => ipcRenderer.invoke(OPEN_LOGIN_CHANNEL),
  pingAgent: () => ipcRenderer.invoke(AGENT_PING_CHANNEL),
});

contextBridge.exposeInMainWorld("forgeDesktop", desktopApi);
