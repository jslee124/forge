export function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (Number.isNaN(port)) {
    throw new Error("Port must be a number.");
  }
  return port;
}
