export interface AgentHealth {
  readonly pid: number;
  readonly resourcesAvailable: boolean;
}

export interface DesktopApi {
  readonly versions: Readonly<{
    electron: string;
    chrome: string;
  }>;
  pingAgent(): Promise<AgentHealth>;
}

export const AGENT_PING_CHANNEL = "forge-desktop:agent-ping";
