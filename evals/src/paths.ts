import { fileURLToPath } from "node:url";

export function repositoryRoot(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}
