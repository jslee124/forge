import { createSessionWorkspace } from "@forge/application";
import type {
  DesktopState,
  ManagementCommand,
} from "../shared/application-protocol.js";
import { DesktopApplication } from "./application.js";
import type { RunExecutor } from "./run-service.js";

/** Selection belongs to the workbench; each execution retains its own application. */
export class SessionApplication {
  readonly #sessions = new Map<string, DesktopApplication>();
  #selected: DesktopApplication;
  constructor(
    readonly env: NodeJS.ProcessEnv,
    readonly cwd: string,
    readonly overrides: ConstructorParameters<
      typeof DesktopApplication
    >[2] = {},
    readonly isBusy: (sessionId?: string) => boolean = () => false,
  ) {
    this.#selected = this.#newApplication();
  }
  #newApplication() {
    return new DesktopApplication(this.env, this.cwd, this.overrides);
  }
  async state(): Promise<DesktopState> {
    return this.#selected.state();
  }
  async manage(command: ManagementCommand): Promise<DesktopState> {
    if (command.type === "resume") {
      const cached = this.#sessions.get(command.sessionId);
      if (cached && this.isBusy(command.sessionId)) {
        this.#selected = cached;
        return cached.state();
      }
      const next = this.#newApplication();
      const state = await next.manage(command);
      this.#sessions.get(command.sessionId)?.close();
      this.#sessions.set(command.sessionId, next);
      this.#selected = next;
      return state;
    }
    if (
      command.type === "workspace" ||
      command.type === "create" ||
      (command.type === "reset" && command.mode !== "clear")
    ) {
      const previous = await this.state();
      const next = this.#newApplication();
      try {
        if (command.type === "workspace") await next.manage(command);
        else if (previous.cwd && !previous.automaticWorkspace) {
          const cwd =
            command.type === "create"
              ? await this.#isolatedWorkspace(previous)
              : previous.cwd;
          await next.manage({ type: "workspace", cwd });
        }
        const state =
          command.type === "create"
            ? await next.manage(command)
            : await next.state();
        this.#selected = next;
        if (state.sessionId) this.#sessions.set(state.sessionId, next);
        return state;
      } catch (error) {
        next.close();
        throw error;
      }
    }
    if (command.type === "delete-session" && this.isBusy(command.sessionId))
      throw new Error("session-busy");
    if (
      this.isBusy() &&
      ![
        "state",
        "browse-session",
        "check-readiness",
        "cancel-login",
        "run-history",
      ].includes(command.type)
    )
      throw new Error("busy");
    // Readiness does not mutate the running conversation or its configuration.
    if (
      command.type === "check-readiness" &&
      this.isBusy((await this.state()).sessionId)
    ) {
      const probe = this.#newApplication();
      try {
        const current = await this.state();
        if (current.cwd)
          await probe.manage({ type: "workspace", cwd: current.cwd });
        return await probe.manage(command);
      } finally {
        probe.close();
      }
    }
    const result = await this.#selected.manage(command);
    if (command.type === "delete-session") {
      const removed = this.#sessions.get(command.sessionId);
      if (removed !== this.#selected) removed?.close();
      this.#sessions.delete(command.sessionId);
    }
    return result;
  }
  #isolatedWorkspace(state: DesktopState): Promise<string> {
    return createSessionWorkspace({
      cwd: state.cwd,
      forgeHome: state.forgeHome,
    });
  }
  readonly execute: RunExecutor = Object.assign(
    async (
      request: Parameters<RunExecutor>[0],
      context: Parameters<RunExecutor>[1],
    ) => {
      const application = this.#sessions.get(request.sessionId);
      if (!application) throw new Error("session-mismatch");
      return application.execute(request, context);
    },
    { deferStartReply: true },
  ) as RunExecutor;
  close(): void {
    this.#selected.close();
    for (const application of this.#sessions.values()) application.close();
  }
}
