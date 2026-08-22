import { randomUUID } from "node:crypto";
import { chmodSync, readFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  open,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { ModelConfigurationError } from "@forge/core";

export type ApiKeyProvider = "deepseek" | "mimo" | "openai";
export type ApiKeySource = "environment" | "stored";

export interface ApiKeyAuthentication {
  readonly kind: "api-key";
  readonly provider: ApiKeyProvider;
  readonly apiKey: string;
  readonly source: ApiKeySource;
  readonly environmentVariable: string;
  readonly credentialPath?: string;
}

export interface AuthenticationStatus {
  readonly provider: ApiKeyProvider;
  readonly method: "api-key";
  readonly authenticated: boolean;
  readonly source?: ApiKeySource;
  readonly environmentVariable: string;
  readonly credentialPath: string;
}

interface StoredApiKey {
  readonly type: "api_key";
  readonly key: string;
}

interface AuthenticationFile {
  readonly version: 1;
  readonly credentials: Partial<Record<ApiKeyProvider, StoredApiKey>>;
}

interface ParsedRecord extends Record<string, unknown> {
  readonly version?: unknown;
  readonly credentials?: unknown;
  readonly type?: unknown;
  readonly key?: unknown;
}

const API_KEY_ENVIRONMENT_VARIABLES = {
  deepseek: "DEEPSEEK_API_KEY",
  mimo: "MIMO_API_KEY",
  openai: "OPENAI_API_KEY",
} as const satisfies Record<ApiKeyProvider, string>;

const EMPTY_AUTHENTICATION_FILE: AuthenticationFile = {
  version: 1,
  credentials: {},
};
const LOCK_STALE_AFTER_MS = 30_000;
const LOCK_RETRIES = 80;

export class AuthenticationStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthenticationStoreError";
  }
}

/** User-scoped, owner-readable credential storage inspired by Pi and OpenCode. */
export class FileCredentialStore {
  readonly path: string;
  readonly #directory: string;

  constructor(forgeHome: string) {
    this.#directory = path.resolve(forgeHome);
    this.path = path.join(this.#directory, "auth.json");
  }

  getApiKey(provider: ApiKeyProvider): string | undefined {
    const key = this.#read().credentials[provider]?.key.trim();
    return key || undefined;
  }

  async setApiKey(provider: ApiKeyProvider, apiKey: string): Promise<void> {
    const key = apiKey.trim();
    if (key === "")
      throw new AuthenticationStoreError("API key cannot be empty.");
    await this.#mutate((current) => ({
      ...current,
      credentials: {
        ...current.credentials,
        [provider]: { type: "api_key", key },
      },
    }));
  }

  async removeApiKey(provider: ApiKeyProvider): Promise<boolean> {
    let removed = false;
    await this.#mutate((current) => {
      if (!current.credentials[provider]) return current;
      removed = true;
      const credentials = { ...current.credentials };
      delete credentials[provider];
      return { ...current, credentials };
    });
    return removed;
  }

  #read(): AuthenticationFile {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, "utf8"));
      const validated = validateAuthenticationFile(parsed);
      chmodSync(this.path, 0o600);
      return validated;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return EMPTY_AUTHENTICATION_FILE;
      if (error instanceof AuthenticationStoreError) throw error;
      throw new AuthenticationStoreError(
        `Could not read ${this.path}. Fix or remove the credential file, then retry.`,
        { cause: error },
      );
    }
  }

  async #mutate(
    update: (current: AuthenticationFile) => AuthenticationFile,
  ): Promise<void> {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await chmod(this.#directory, 0o700);
    const lockPath = `${this.path}.lock`;
    const lock = await acquireLock(lockPath);
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const next = update(this.#read());
      await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, this.path);
      await chmod(this.path, 0o600);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    } finally {
      await lock.close().catch(() => undefined);
      await unlink(lockPath).catch(() => undefined);
    }
  }
}

/** Resolves environment credentials first, then the user-scoped auth store. */
export class AuthenticationManager {
  readonly #env: NodeJS.ProcessEnv;
  readonly #store: FileCredentialStore;

  constructor(
    env: NodeJS.ProcessEnv = process.env,
    store = new FileCredentialStore(resolveForgeHome(env)),
  ) {
    this.#env = env;
    this.#store = store;
  }

  status(provider: ApiKeyProvider): AuthenticationStatus {
    const environmentVariable = API_KEY_ENVIRONMENT_VARIABLES[provider];
    const environmentKey = this.#env[environmentVariable]?.trim();
    const storedKey = environmentKey
      ? undefined
      : this.#store.getApiKey(provider);
    const source = environmentKey
      ? ("environment" as const)
      : storedKey
        ? ("stored" as const)
        : undefined;
    return {
      provider,
      method: "api-key",
      authenticated: source !== undefined,
      ...(source ? { source } : {}),
      environmentVariable,
      credentialPath: this.#store.path,
    };
  }

  requireApiKey(provider: ApiKeyProvider): ApiKeyAuthentication {
    const status = this.status(provider);
    const apiKey =
      status.source === "environment"
        ? this.#env[status.environmentVariable]?.trim()
        : this.#store.getApiKey(provider);
    if (!apiKey) {
      const distinction =
        provider === "openai"
          ? " ChatGPT subscriptions do not include OpenAI API usage; use `forge codex` for subscription access."
          : "";
      throw new ModelConfigurationError(
        `Missing ${status.environmentVariable}. Use /login to save a ${provider} API key, or export ${status.environmentVariable}.${distinction}`,
      );
    }
    return {
      kind: "api-key",
      provider,
      apiKey,
      source: status.source ?? "stored",
      environmentVariable: status.environmentVariable,
      ...(status.source === "stored"
        ? { credentialPath: status.credentialPath }
        : {}),
    };
  }

  async storeApiKey(provider: ApiKeyProvider, apiKey: string): Promise<string> {
    await this.#store.setApiKey(provider, apiKey);
    return this.#store.path;
  }

  removeStoredApiKey(provider: ApiKeyProvider): Promise<boolean> {
    return this.#store.removeApiKey(provider);
  }
}

export function resolveForgeHome(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(
    (env as { FORGE_HOME?: string }).FORGE_HOME?.trim() ||
      path.join(homedir(), ".forge"),
  );
}

export function isApiKeyProvider(value: string): value is ApiKeyProvider {
  return value === "deepseek" || value === "mimo" || value === "openai";
}

async function acquireLock(
  lockPath: string,
): Promise<Awaited<ReturnType<typeof open>>> {
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
    try {
      return await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) {
        throw new AuthenticationStoreError(
          `Could not lock credential store ${lockPath}.`,
          { cause: error },
        );
      }
      if (await isStaleLock(lockPath)) {
        await unlink(lockPath).catch(() => undefined);
        continue;
      }
      await delay(Math.min(20 + attempt * 5, 100));
    }
  }
  throw new AuthenticationStoreError(
    `Credential store ${lockPath} is busy. Retry in a moment.`,
  );
}

async function isStaleLock(lockPath: string): Promise<boolean> {
  try {
    return Date.now() - (await stat(lockPath)).mtimeMs > LOCK_STALE_AFTER_MS;
  } catch (error) {
    return isNodeError(error, "ENOENT");
  }
}

function validateAuthenticationFile(value: unknown): AuthenticationFile {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.credentials)) {
    throw new AuthenticationStoreError(
      "Credential file has an unsupported or invalid format.",
    );
  }
  const credentials: Partial<Record<ApiKeyProvider, StoredApiKey>> = {};
  for (const provider of ["deepseek", "mimo", "openai"] as const) {
    const credential = value.credentials[provider];
    if (credential === undefined) continue;
    if (
      !isRecord(credential) ||
      credential.type !== "api_key" ||
      typeof credential.key !== "string" ||
      credential.key.trim() === ""
    ) {
      throw new AuthenticationStoreError(
        `Credential file contains an invalid ${provider} entry.`,
      );
    }
    credentials[provider] = { type: "api_key", key: credential.key };
  }
  return { version: 1, credentials };
}

function isRecord(value: unknown): value is ParsedRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
