import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FileSessionStore, recordRunInSession } from "@forge/persistence";
import type { BrowserWindow } from "electron";

/** Explicit development acceptance fixture; never invokes a model or fabricates provider evidence. */
export async function runUiAcceptance(
  window: BrowserWindow,
  home: string,
  output: string,
): Promise<void> {
  await mkdir(output, { recursive: true });
  const store = new FileSessionStore(home);
  const fixtures: { id: string; cwd: string; kind: string; file: string }[] =
    [];
  for (const kind of ["code", "local", "research"]) {
    const directory = join(home, "fixtures", kind);
    await mkdir(directory, { recursive: true });
    const cwd = await realpath(directory);
    const file =
      kind === "code"
        ? "sum.js"
        : kind === "local"
          ? "output.csv"
          : "report.md";
    const content =
      kind === "code"
        ? "export function add(a, b) { return a - b; }\n"
        : kind === "local"
          ? "id,amount\n001,10\n002,20\nTOTAL,30\n"
          : "# Source report / 来源报告\n\n[Example Domain](https://example.com/) — retrieved text / 已读正文。\n\nSearch snippets are not page bodies. 搜索摘要不是正文。\n";
    await writeFile(join(cwd, file), content);
    const snapshot = recordRunInSession(store.create({ root: cwd, cwd }), {
      prompt: `D12 ${kind} — offline UI fixture / 离线界面样例`,
      finalText: content,
      status: "completed",
      runId: randomUUID(),
    });
    await store.save(snapshot);
    fixtures.push({ id: snapshot.id, cwd, kind, file });
  }
  const js = (code: string) => window.webContents.executeJavaScript(code);
  const until = async (condition: string) => {
    console.log("D12 UI wait", condition);
    await js(
      `new Promise((resolve, reject) => { const end = Date.now() + 10000; const poll = () => { if (${condition}) resolve(true); else if(Date.now() > end) reject(new Error('UI condition timed out')); else setTimeout(poll, 40); }; poll(); })`,
    );
  };
  const click = async (selector: string) => {
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const results: unknown[] = [];
  const capture = async (name: string) => {
    await js("document.fonts.ready");
    await js(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    const metrics = await js(
      `({ width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth, locale: document.documentElement.lang, fixture: document.body.innerText.includes('offline UI fixture') })`,
    );
    if (metrics.overflow) throw new Error(`Horizontal overflow: ${name}`);
    await writeFile(
      join(output, `${name}.png`),
      (await window.webContents.capturePage()).toPNG(),
    );
    results.push({ name, ...metrics });
  };
  // Read the renderer's current state after a real main/preload/Agent reload.
  window.webContents.reload();
  await until(
    `document.querySelector('[data-session-id="${fixtures[0]?.id}"]')`,
  );
  for (const locale of ["zh-CN", "en"]) {
    await click('[data-testid="settings"]');
    await until("document.querySelector('[data-testid=language]')");
    await js(
      `{ const select = document.querySelector('[data-testid=language]'); select.value = ${JSON.stringify(locale)}; select.dispatchEvent(new Event('change', { bubbles: true })); }`,
    );
    await until(`document.documentElement.lang === ${JSON.stringify(locale)}`);
    await capture(`${locale}-settings`);
    for (const f of fixtures) {
      await click(`[data-session-id="${f.id}"]`);
      await until(
        `document.querySelector('[data-testid=file-path]') && !document.querySelector('[data-testid=refresh-review]').disabled && document.body.innerText.includes('D12 ${f.kind}')`,
      );
      await until(
        "!document.querySelector('.artifact-preview') && !document.querySelector('.change-review')",
      );
      if (f.kind === "code") {
        const current = await readFile(join(f.cwd, f.file), "utf8");
        await writeFile(
          join(f.cwd, f.file),
          current.includes("a - b")
            ? "export function add(a, b) { return a + b; }\n"
            : "export function add(a, b) { return a - b; }\n",
        );
        await click('[data-testid="refresh-review"]');
        await until("document.querySelector('.change-review details')");
        await js(
          "document.querySelector('.change-review details').open = true",
        );
      }
      await js(
        `{ const input = document.querySelector('[data-testid=file-path]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(f.file)}); input.dispatchEvent(new Event('input', {bubbles: true})); }`,
      );
      await until(
        "!document.querySelector('[data-testid=preview-file]').disabled",
      );
      await click('[data-testid="preview-file"]');
      await until("document.querySelector('.artifact-preview')");
      if (f.kind === "local")
        await until(
          "document.querySelector('.table-preview')?.textContent.includes('001')",
        );
      await capture(`${locale}-${f.kind}`);
    }
    window.setContentSize(840, 800);
    await capture(`${locale}-narrow-research`);
    window.setContentSize(1100, 728);
  }
  await writeFile(
    join(output, "ui.json"),
    `${JSON.stringify({ kind: "offline rendered UI with real IPC and file services; no model calls", results }, null, 2)}\n`,
  );
}
