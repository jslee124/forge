import { parsePort } from "./parse-port.ts";

export interface ServerConfig {
  readonly port: number;
}

export function loadServerConfig(env: NodeJS.ProcessEnv): ServerConfig {
  return { port: parsePort(env.PORT ?? "3000") };
}
