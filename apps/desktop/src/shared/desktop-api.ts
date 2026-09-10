import type {
  DesktopState,
  ManagementCommand,
} from "./application-protocol.js";
import type { FileApi } from "./file-protocol.js";
import type { RunCommand, RunEvent } from "./run-protocol.js";
export interface AgentHealth {
  readonly pid: number;
  readonly resourcesAvailable: boolean;
}

export interface DesktopApi extends FileApi {
  readonly versions: Readonly<{
    electron: string;
    chrome: string;
  }>;
  runCommand(command: RunCommand): Promise<boolean>;
  onRunEvent(listener: (event: RunEvent) => void): () => void;
  manage(
    command: Exclude<ManagementCommand, { type: "workspace" }>,
  ): Promise<DesktopState>;
  chooseWorkspace(): Promise<DesktopState | null>;
  openLogin(): Promise<void>;
  pingAgent(): Promise<AgentHealth>;
}

export const AGENT_PING_CHANNEL = "forge-desktop:agent-ping";

export const RUN_COMMAND_CHANNEL = "forge-desktop:run-command";
export const RUN_EVENT_CHANNEL = "forge-desktop:run-event";
