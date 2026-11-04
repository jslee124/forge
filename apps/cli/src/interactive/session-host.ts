import type { SessionRunState } from "@forge/application";

export type TuiSessionStatus =
  | "ready"
  | "queued"
  | "running"
  | "approval"
  | "completed"
  | "failed"
  | "cancelled";
export interface InteractiveSessionHost {
  readonly visible: boolean;
  readonly focused: boolean;
  readonly newSession: () => void;
  readonly showSessions: () => void;
  readonly requestExit: () => void;
  readonly report: (status: TuiSessionStatus) => void;
  readonly submitted: (prompt: string) => void;
  schedule<T>(
    runId: string,
    controller: AbortController,
    execute: () => Promise<T>,
    onState: (state: SessionRunState) => void,
  ): Promise<T>;
}
