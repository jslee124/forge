import { loadForgeConfig } from "@forge/config";
import type {
  ModelConversationMessage,
  RunResult,
  WorkspaceContext,
} from "@forge/core";
import {
  configuredSecrets,
  FileSessionStore,
  recordRunInSession,
  type SessionSnapshot,
  type SessionSummary,
} from "@forge/persistence";

import type { RunMetadata } from "./run.js";

export interface InteractiveSessionPersistence {
  readonly messages: readonly ModelConversationMessage[];
  readonly sessionId: string | undefined;
  prepareRun(): Promise<string>;
  recordRun(
    prompt: string,
    result: RunResult,
    metadata: RunMetadata,
  ): Promise<void>;
  clear(): void;
  list(): Promise<readonly SessionSummary[]>;
  resume(sessionId: string): Promise<readonly ModelConversationMessage[]>;
}

export class PersistentInteractiveSession
  implements InteractiveSessionPersistence
{
  readonly #store: FileSessionStore;
  readonly #workspace: WorkspaceContext;
  #snapshot: SessionSnapshot | undefined;

  constructor(options: {
    readonly store: FileSessionStore;
    readonly workspace: WorkspaceContext;
    readonly snapshot?: SessionSnapshot;
  }) {
    this.#store = options.store;
    this.#workspace = options.workspace;
    this.#snapshot = options.snapshot;
  }

  get messages(): readonly ModelConversationMessage[] {
    return this.#snapshot?.messages ?? [];
  }

  get sessionId(): string | undefined {
    return this.#snapshot?.id;
  }

  async prepareRun(): Promise<string> {
    if (!this.#snapshot) {
      this.#snapshot = this.#store.create(this.#workspace);
    }
    return this.#snapshot.id;
  }

  async recordRun(
    prompt: string,
    result: RunResult,
    metadata: RunMetadata,
  ): Promise<void> {
    if (!this.#snapshot) {
      this.#snapshot = this.#store.create(this.#workspace);
    }
    this.#snapshot = recordRunInSession(this.#snapshot, {
      prompt,
      finalText: result.finalText,
      status: result.status,
      runId: metadata.runId,
    });
    if (this.#snapshot.messages.length > 0) {
      await this.#store.save(this.#snapshot);
    }
  }

  clear(): void {
    this.#snapshot = undefined;
  }

  list(): Promise<readonly SessionSummary[]> {
    return this.#store.list(this.#workspace.root);
  }

  async resume(
    sessionId: string,
  ): Promise<readonly ModelConversationMessage[]> {
    this.#snapshot = await this.#store.loadForWorkspace(
      sessionId,
      this.#workspace.root,
    );
    return this.#snapshot.messages;
  }
}

export async function createPersistentInteractiveSession(options: {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly sessionId?: string;
  readonly last?: boolean;
}): Promise<PersistentInteractiveSession> {
  const loaded = await loadForgeConfig({ cwd: options.cwd, env: options.env });
  const workspace = {
    root: loaded.workspaceRoot,
    cwd: loaded.workingDirectory,
  };
  const store = new FileSessionStore(loaded.forgeHome, {
    secrets: configuredSecrets(options.env),
  });
  let snapshot: SessionSnapshot | undefined;
  if (options.sessionId) {
    snapshot = await store.loadForWorkspace(options.sessionId, workspace.root);
  } else if (options.last) {
    snapshot = await store.latest(workspace.root);
  }
  return new PersistentInteractiveSession({
    store,
    workspace,
    ...(snapshot ? { snapshot } : {}),
  });
}
