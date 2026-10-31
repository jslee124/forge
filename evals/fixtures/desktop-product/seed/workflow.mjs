// Deliberately defective exercise seed. Do not use as product code.
export function parsePort(value) {
  return Number(value);
}
export function theme(user) {
  return { ...user, theme: "dark" };
}
let busy = false;
export async function submit(send) {
  busy = true;
  await send();
  busy = false;
}
export function relativePath(value) {
  return value.trim().split(" ")[0];
}
export async function propagate(action) {
  try {
    return await action();
  } catch {
    return "ok";
  }
}
export function dispatch(requestId) {
  return { requestId };
}
export async function handle(requestId, tool) {
  return tool(dispatch(requestId));
}
