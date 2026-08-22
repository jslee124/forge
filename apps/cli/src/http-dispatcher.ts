import * as undici from "undici";

export interface HttpProxySettings {
  readonly httpProxy?: string;
  readonly httpsProxy?: string;
  readonly noProxy?: string;
}

interface HttpProxyEnvironment extends NodeJS.ProcessEnv {
  readonly HTTP_PROXY?: string;
  readonly HTTPS_PROXY?: string;
  readonly NO_PROXY?: string;
  readonly http_proxy?: string;
  readonly https_proxy?: string;
  readonly no_proxy?: string;
}

interface HttpDispatcherDependencies {
  readonly createAgent: (
    options: undici.EnvHttpProxyAgent.Options,
  ) => undici.Dispatcher;
  readonly setGlobalDispatcher: (dispatcher: undici.Dispatcher) => void;
  readonly install: () => void;
}

const defaultDependencies: HttpDispatcherDependencies = {
  createAgent: (options) => new undici.EnvHttpProxyAgent(options),
  setGlobalDispatcher: undici.setGlobalDispatcher,
  install: undici.install,
};

export function resolveHttpProxySettings(
  env: HttpProxyEnvironment,
): HttpProxySettings {
  const httpProxy = firstDefined(env.http_proxy, env.HTTP_PROXY);
  const httpsProxy = firstDefined(env.https_proxy, env.HTTPS_PROXY);
  const noProxy = firstDefined(env.no_proxy, env.NO_PROXY);
  validateProxyUrl(httpProxy, "HTTP_PROXY");
  validateProxyUrl(httpsProxy, "HTTPS_PROXY");
  return {
    ...(httpProxy !== undefined ? { httpProxy } : {}),
    ...(httpsProxy !== undefined ? { httpsProxy } : {}),
    ...(noProxy !== undefined ? { noProxy } : {}),
  };
}

export function configureHttpDispatcher(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: HttpDispatcherDependencies = defaultDependencies,
): boolean {
  const settings = resolveHttpProxySettings(env);
  if (!settings.httpProxy && !settings.httpsProxy) {
    return false;
  }
  const dispatcher = dependencies.createAgent(settings);
  dependencies.setGlobalDispatcher(dispatcher);
  dependencies.install();
  return true;
}

function firstDefined(
  lowercase: string | undefined,
  uppercase: string | undefined,
): string | undefined {
  return lowercase ?? uppercase;
}

function validateProxyUrl(value: string | undefined, label: string): void {
  if (value === undefined || value === "") return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTP or HTTPS proxy URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use the http:// or https:// scheme.`);
  }
}
