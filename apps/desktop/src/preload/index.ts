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
  CHANGE_REVIEW_CHANNEL,
  changeReviewSchema,
  FILE_IMPORT_CHANNEL,
  FILE_OPEN_CHANNEL,
  FILE_PREVIEW_CHANNEL,
  FILE_REVEAL_CHANNEL,
  FILE_SAVE_AS_CHANNEL,
  type FilePreview,
  filePreviewSchema,
  importedFileSchema,
  type PreviewRequest,
  previewRequestSchema,
  relativeFilePathSchema,
  savedFileSchema,
} from "../shared/file-protocol.js";

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
  importFile: async () => {
    const value: unknown = await ipcRenderer.invoke(FILE_IMPORT_CHANNEL);
    return value === null ? null : importedFileSchema.parse(value);
  },
  previewFile: async (request: PreviewRequest): Promise<FilePreview> =>
    filePreviewSchema.parse(
      await ipcRenderer.invoke(
        FILE_PREVIEW_CHANNEL,
        previewRequestSchema.parse(request),
      ),
    ) as FilePreview,
  saveFileAs: async (path: string) => {
    const value: unknown = await ipcRenderer.invoke(
      FILE_SAVE_AS_CHANNEL,
      relativeFilePathSchema.parse(path),
    );
    return value === null ? null : savedFileSchema.parse(value);
  },
  openFile: (path: string) =>
    ipcRenderer.invoke(FILE_OPEN_CHANNEL, relativeFilePathSchema.parse(path)),
  revealFile: (path: string) =>
    ipcRenderer.invoke(FILE_REVEAL_CHANNEL, relativeFilePathSchema.parse(path)),
  reviewChanges: async () =>
    changeReviewSchema.parse(await ipcRenderer.invoke(CHANGE_REVIEW_CHANNEL)),
});

contextBridge.exposeInMainWorld("forgeDesktop", desktopApi);
