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

/** Providers Forge ships an adapter and a known environment variable for. */
export type BuiltInApiKeyProvider = "deepseek" | "openai";

/**
 * A credential owner: a built-in provider, or a configured third-party route
 * key. Route names are checked before reaching the store, so a caller cannot
 * write an arbitrary property into the credential file.
 */
export type ApiKeyProvider = string;
export type ApiKeySource = "environment" | "stored";

/** Route names the credential store accepts, matching the config schema. */
const ROUTE_NAME = /^[a-z][a-z0-9-]{0,63}$/u;

export interface ApiKeyAuthentication {
  readonly kind: "api-key";
  readonly provider: ApiKeyProvider;
  readonly apiKey: string;
  readonly source: ApiKeySource;
  readonly environmentVariable: string;
  readonly credentialPath?: string;
}

/** Per-call overrides for a route whose profile names its own variable. */
export interface ApiKeyLookupOptions {
  readonly environmentVariable?: string;
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
  readonly credentials: Readonly<Record<string, StoredApiKey>>;
}

interface ParsedRecord extends Record<string, unknown> {
  readonly version?: unknown;
  readonly credentials?: unknown;
  readonly type?: unknown;
  readonly key?: unknown;
}

const API_KEY_ENVIRONMENT_VARIABLES = {
  deepseek: "DEEPSEEK_API_KEY",
  openai: "OPENAI_API_KEY",
} as const satisfies Record<BuiltInApiKeyProvider, string>;

/**
 * The environment variable consulted for one credential owner.
 *
 * A built-in provider keeps its published name. A third-party route uses the
 * name its profile declares, falling back to a name derived from the route so
 * a key can be exported without first editing configuration.
 */
export function apiKeyEnvironmentVariable(
  provider: ApiKeyProvider,
  declared?: string,
): string {
  if (declared !== undefined && declared !== "") return declared;
  if (isBuiltInApiKeyProvider(provider)) {
    return API_KEY_ENVIRONMENT_VARIABLES[provider];
  }
  return `FORGE_${provider.replaceAll("-", "_").toLocaleUpperCase()}_API_KEY`;
}

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

/** Refuse a name that must never become a key in the credential file. */
function assertCredentialOwner(provider: string): void {
  if (!isApiKeyProvider(provider)) {
    throw new AuthenticationStoreError(
      `"${provider}" is not a usable credential name. Use a provider route of lowercase letters, digits, and hyphens.`,
    );
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
    if (!isApiKeyProvider(provider)) return undefined;
    const key = Object.hasOwn(this.#read().credentials, provider)
      ? this.#read().credentials[provider]?.key.trim()
      : undefined;
    return key || undefined;
  }

  async setApiKey(provider: ApiKeyProvider, apiKey: string): Promise<void> {
    assertCredentialOwner(provider);
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
    assertCredentialOwner(provider);
    let removed = false;
    await this.#mutate((current) => {
      if (!Object.hasOwn(current.credentials, provider)) return current;
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
      // Tightening permissions is best-effort hardening, not a precondition
      // for reading. A read-only mount, or a file owned by another user but
      // readable, must not make an otherwise valid credential file unusable.
      try {
        chmodSync(this.path, 0o600);
      } catch {
        // The credential was still read; the mode simply could not be changed.
      }
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

  status(
    provider: ApiKeyProvider,
    options: ApiKeyLookupOptions = {},
  ): AuthenticationStatus {
    const environmentVariable = apiKeyEnvironmentVariable(
      provider,
      options.environmentVariable,
    );
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

  requireApiKey(
    provider: ApiKeyProvider,
    options: ApiKeyLookupOptions = {},
  ): ApiKeyAuthentication {
    const status = this.status(provider, options);
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

export function isBuiltInApiKeyProvider(
  value: string,
): value is BuiltInApiKeyProvider {
  return value === "deepseek" || value === "openai";
}

/**
 * Whether a name may own a credential. Built-in providers always may; any
 * other name must look like a configured route, so a caller cannot reach
 * `__proto__` or an arbitrary key in the credential file.
 */
export function isApiKeyProvider(value: string): value is ApiKeyProvider {
  return isBuiltInApiKeyProvider(value) || ROUTE_NAME.test(value);
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
  const credentials: Record<string, StoredApiKey> = Object.create(
    null,
  ) as Record<string, StoredApiKey>;
  for (const [provider, credential] of Object.entries(value.credentials)) {
    // A name that could never be written by Forge is skipped rather than
    // rejected: a hand-edited stray entry should not make every other stored
    // credential unreadable. `JSON.parse` exposes "__proto__" as an ordinary
    // key, and this is what refuses it.
    if (!isApiKeyProvider(provider)) continue;
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
