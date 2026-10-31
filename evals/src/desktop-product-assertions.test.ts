import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const { checkProductEdit } = await import(
  new URL("../scripts/desktop-product-assertions.mjs", import.meta.url).href
);
const seed = fileURLToPath(
  new URL("../fixtures/desktop-product/seed/", import.meta.url),
);
const solutions = {
  E01: `export function parsePort(value) { if(typeof value!=='string'||!/^\\d+$/.test(value)||Number(value)<1||Number(value)>65535)throw new Error('port');return Number(value); }`,
  E02: `export function theme(user) {return {theme:'system',...user};}`,
  E03: `let busy=false;export async function submit(send) {if(busy)return;busy=true;try{return await send()}finally{busy=false}}`,
  E04: `export function relativePath(value) {if(typeof value!=='string'||value.startsWith('/')||/^[a-z]:/i.test(value)||value.startsWith('\\\\')||value.split(/[\\\\/]/).includes('..'))throw new Error('path');return value}`,
  E05: `export async function propagate(action) {return await action()}`,
  E06: `export function dispatch(operationId) {return {operationId}};export async function handle(operationId,tool) {return tool(dispatch(operationId))}`,
};
for (const [task, solution] of Object.entries(solutions))
  it(`rejects the defective ${task} seed and accepts a behaviorally corrected module`, async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-edit-assertions-"));
    const workspace = join(root, "workspace");
    try {
      await cp(seed, workspace, { recursive: true });
      expect((await checkProductEdit(task, workspace, root)).status).toBe(
        "failed",
      );
      await writeFile(join(workspace, "workflow.mjs"), solution);
      if (task === "E06")
        await writeFile(
          join(workspace, "main.mjs"),
          `import {handle} from './workflow.mjs';export const receive=(operationId,tool)=>handle(operationId,tool)`,
        );
      const checked = await checkProductEdit(task, workspace, root);
      expect(checked).toMatchObject({ status: "passed", failures: [] });
      expect(checked.assertions).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
it("does not accept a broken rename or a syntactically broken edited module", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-edit-assertions-"));
  try {
    await cp(seed, root, { recursive: true });
    await writeFile(join(root, "workflow.mjs"), solutions.E06);
    const main = await readFile(join(root, "main.mjs"), "utf8");
    await writeFile(join(root, "main.mjs"), main);
    expect((await checkProductEdit("E06", root, root)).status).toBe("failed");
    await writeFile(join(root, "workflow.mjs"), "export function");
    expect((await checkProductEdit("E01", root, root)).status).toBe("failed");
    await expect(checkProductEdit("constructor", root, root)).rejects.toThrow(
      "No independent",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
