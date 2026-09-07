import { contextBridge, ipcRenderer } from "electron";
import { AGENT_PING_CHANNEL, type DesktopApi } from "../shared/desktop-api.js";

const desktopApi: DesktopApi = Object.freeze({
  versions: Object.freeze({
    electron: process.versions.electron ?? "unknown",
    chrome: process.versions.chrome ?? "unknown",
  }),
  pingAgent: () => ipcRenderer.invoke(AGENT_PING_CHANNEL),
});

contextBridge.exposeInMainWorld("forgeDesktop", desktopApi);
