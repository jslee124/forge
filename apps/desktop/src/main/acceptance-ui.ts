import { randomUUID } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
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
    await until(
      `document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`,
    );
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const results: unknown[] = [];
  const capture = async (name: string) => {
    await js("document.fonts.ready");
    await js("new Promise(resolve => setTimeout(resolve, 180))");
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
  for (const appearance of ["light", "dark"]) {
    await click('[data-testid="settings"]');
    await until("document.querySelector('.theme-options button')");
    await click(
      `.theme-options button:nth-child(${appearance === "light" ? 1 : 2})`,
    );
    await until(`document.documentElement.dataset.theme === '${appearance}'`);
    window.webContents.reload();
    await until(
      `document.documentElement.dataset.theme === '${appearance}' && document.querySelector('[data-testid="settings"]')`,
    );
    for (const locale of ["zh-CN", "en"]) {
      await click('[data-testid="settings"]');
      await until("document.querySelector('[data-testid=language]')");
      await js(
        `{ const select = document.querySelector('[data-testid=language]'); select.value = ${JSON.stringify(locale)}; select.dispatchEvent(new Event('change', { bubbles: true })); }`,
      );
      await until(
        `document.documentElement.lang === ${JSON.stringify(locale)}`,
      );
      await capture(`${appearance}-${locale}-settings`);
      for (const f of fixtures) {
        if (f.kind === "code")
          await writeFile(
            join(f.cwd, f.file),
            "export function add(a, b) { return a - b; }\n",
          );
        await click(`[data-session-id="${f.id}"]`);
        await until(
          `document.querySelector('[data-testid=file-path]') && !document.querySelector('[data-testid=refresh-review]').disabled && document.querySelector('.live-transcript')?.textContent.includes('D12 ${f.kind}') && !document.querySelector('[data-testid=composer-engine]').disabled`,
        );
        await until(
          "!document.querySelector('.artifact-preview') && !document.querySelector('.change-review')",
        );
        if (f.kind === "code") {
          await writeFile(
            join(f.cwd, f.file),
            "export function add(a, b) { return a + b; }\n",
          );
          await click('[data-testid="refresh-review"]');
          await until(
            "document.querySelector('.change-review details:not(.studio-review-scope)')",
          );
          await js(
            "document.querySelector('.change-review details:not(.studio-review-scope)').open = true",
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
        await click(".studio-tabs button:nth-child(1)");
        await capture(`${appearance}-${locale}-${f.kind}`);
        if (f.kind === "code") {
          await click(".studio-tabs button:nth-child(2)");
          await capture(`${appearance}-${locale}-changes`);
          await click(".studio-tabs button:nth-child(1)");
        }
      }
      window.setContentSize(840, 800);
      await capture(`${appearance}-${locale}-narrow-research`);
      window.setContentSize(1100, 728);
    }
  }
  await until(
    "!document.querySelector('.sidebar > button:first-of-type').disabled",
  );
  await click(".sidebar > button:first-of-type");
  await until(
    "document.querySelector('.studio-welcome') && !document.querySelector('.live-panel')",
  );
  await capture("home-dark");
  await click('[data-testid="sidebar-toggle"]');
  await until(
    "document.querySelector('.studio-square-mark')?.complete && document.querySelector('.studio-square-mark')?.naturalWidth > 0 && getComputedStyle(document.querySelector('.sidebar')).display === 'none'",
  );
  await capture("home-dark-collapsed");
  await click('[data-testid="sidebar-toggle"]');
  await until(
    "!document.querySelector('.studio-square-mark') && getComputedStyle(document.querySelector('.sidebar')).display !== 'none' && !document.querySelector('.studio-brand').textContent.includes('DESKTOP')",
  );
  await click('[data-testid="settings"]');
  await click(".theme-options button:nth-child(1)");
  await until(
    "!document.querySelector('.sidebar > button:first-of-type').disabled",
  );
  await click(".sidebar > button:first-of-type");
  await capture("home-light");
  await click('[data-testid="sidebar-toggle"]');
  await until(
    "document.querySelector('.studio-square-mark')?.complete && document.querySelector('.studio-square-mark')?.naturalWidth > 0 && getComputedStyle(document.querySelector('.sidebar')).display === 'none'",
  );
  await capture("home-light-collapsed");
  await click('[data-testid="sidebar-toggle"]');
  await until(
    "!document.querySelector('.studio-square-mark') && getComputedStyle(document.querySelector('.sidebar')).display !== 'none' && !document.querySelector('.studio-brand').textContent.includes('DESKTOP')",
  );
  await js(
    `(() => { const el=document.querySelector('.live-composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'/'); el.dispatchEvent(new Event('input',{bubbles:true})); })()`,
  );
  await until("document.querySelector('.studio-slash-menu')");
  await capture("commands-light");
  await click(".studio-slash-menu button");
  await until(
    "document.querySelector('.studio-notice')?.textContent.includes('/help')",
  );
  await js(
    `(() => { if(document.querySelector('.prototype-banner') || document.querySelector('.studio-theme-toggle')) throw new Error('Old chrome remains'); const sidebar=document.querySelector('.sidebar'); if(!sidebar.contains(document.querySelector('[data-testid=sidebar-toggle]'))) throw new Error('Toggle outside sidebar'); if(!document.querySelector('.live-composer').contains(document.querySelector('[data-testid=composer-engine]'))) throw new Error('Engine outside composer'); })()`,
  );
  await click(".studio-suggestions button:first-child");
  await until(
    "document.querySelector('.live-composer textarea').value.length > 0",
  );
  await click('[data-testid="settings"]');
  await click(".theme-options button:nth-child(3)");
  await until(
    "localStorage.getItem('forge.desktop.theme') === 'system' && document.documentElement.dataset.theme === (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')",
  );
  // Component extraction must preserve draft ownership and control callbacks.
  await click(".studio-back");
  await click(`[data-session-id="${fixtures[0]?.id}"]`);
  await until(
    `document.querySelector('[data-session-id="${fixtures[0]?.id}"]')?.getAttribute("aria-current") === "page"`,
  );
  await until("document.querySelector('.live-composer textarea')");
  await js(
    `(() => { const el=document.querySelector('.live-composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'P0 retained draft'); el.dispatchEvent(new Event('input',{bubbles:true})); })()`,
  );
  await until(
    "document.querySelector('.live-composer textarea').value === 'P0 retained draft'",
  );
  await click(`[data-session-id="${fixtures[1]?.id}"]`);
  await until(
    `document.querySelector('[data-session-id="${fixtures[1]?.id}"]')?.getAttribute("aria-current") === "page"`,
  );
  await until(
    "document.querySelector('.live-composer textarea').value !== 'P0 retained draft'",
  );
  await click(`[data-session-id="${fixtures[0]?.id}"]`);
  await until(
    `document.querySelector('[data-session-id="${fixtures[0]?.id}"]')?.getAttribute("aria-current") === "page"`,
  );
  await until(
    "document.querySelector('.live-composer textarea').value === 'P0 retained draft'",
  );
  await js(
    `(() => { const el=document.querySelector('[data-testid=composer-engine]'); el.value='codex'; el.dispatchEvent(new Event('change',{bubbles:true})); })()`,
  );
  await until(
    "document.querySelector('[data-testid=composer-engine]').value === 'codex' && document.querySelector('.studio-permission select').value === 'workspace-write'",
  );
  await js(
    `(() => { const el=document.querySelector('[data-testid=composer-engine]'); el.value='native'; el.dispatchEvent(new Event('change',{bubbles:true})); })()`,
  );
  await until(
    "document.querySelector('[data-testid=composer-engine]').value === 'native' && document.querySelector('.studio-permission select').value === 'safe'",
  );
  const enterDraft = async (value: string) => {
    await js(
      `(() => { const el=document.querySelector('.live-composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.focus(); })()`,
    );
  };
  await enterDraft("/");
  await until(
    "document.querySelector('[role=combobox]').getAttribute('aria-expanded') === 'true'",
  );
  await js(
    `(() => { const el=document.querySelector('.live-composer textarea'); for(let i=0;i<15;i++) el.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})); })()`,
  );
  await until(
    "document.querySelector('[aria-selected=true]')?.id === 'slash-option-15' && document.querySelector('.studio-slash-menu').scrollTop > 0",
  );
  await js(
    `document.querySelector('.live-composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
  );
  await until(
    "!document.querySelector('.studio-slash-menu') && document.activeElement === document.querySelector('.live-composer textarea')",
  );
  await enterDraft("/compact --d");
  await until(
    "document.querySelector('.studio-slash-menu strong')?.textContent === '/compact --dry-run'",
  );
  await js(
    `document.querySelector('.live-composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}))`,
  );
  await until(
    "document.querySelector('.live-composer textarea').value === '/compact --dry-run' && !document.querySelector('.studio-slash-menu')",
  );
  await enterDraft("/not-a-command");
  await js(
    `document.querySelector('.live-composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}))`,
  );
  await until(
    "document.querySelector('.live-composer textarea').value === '/not-a-command' && document.querySelector('.studio-notice')?.textContent.includes('Send as message')",
  );
  await enterDraft("/help");
  await js(
    `document.querySelector('.live-composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}))`,
  );
  await until(
    "document.querySelector('.live-composer textarea').value === '/help'",
  );
  await click('[data-testid="settings"]');
  await click(".theme-options button:nth-child(1)");
  await click(".studio-back");
  await enterDraft("/compact --dry-run");
  await js(
    `document.querySelector('.live-composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}))`,
  );
  await until(
    "document.querySelector('.studio-notice')?.textContent.includes('Compaction preview') && document.querySelector('.live-composer textarea').value === ''",
  );
  await enterDraft("/permissions");
  await js(
    `document.querySelector('.live-composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
  );
  await until("document.querySelector('.studio-permissions-details').open");
  await capture("permissions-light");
  await js(`document.querySelector('.studio-permissions-details').open=false`);
  await enterDraft("/context");
  await js(
    `document.querySelector('.live-composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
  );
  await until("document.querySelector('.studio-context-usage').open");
  await capture("context-light");
  await js(`document.querySelector('.studio-context-usage').open=false`);
  await click('[data-testid="composer-model"]');
  await until("document.querySelector('.studio-model-popover')");
  await until(
    "(() => {const p=document.querySelector('.studio-model-popover').getBoundingClientRect();const m=document.querySelector('.live-main').getBoundingClientRect();return p.left>=m.left && p.right<=m.right && p.top>=0;})()",
  );
  await capture("models-light");
  await js(
    `(() => {const el=document.querySelector('.studio-model-popover input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'no-such-model');el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await until(
    "document.querySelector('.studio-model-results').children.length === 0",
  );
  await click('[data-testid="composer-model"]');
  await enterDraft("Unsent draft");
  await until(
    "(() => {const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;})()",
  );
  await enterDraft("/resources");
  await js(
    `document.querySelector('.live-composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
  );
  await until(
    "document.querySelector('.studio-management') && !document.querySelector('.studio-management select').disabled",
  );
  await js(
    "document.querySelector('.studio-management').scrollIntoView({block:'start'})",
  );
  await capture("management-light");
  await js(
    "document.querySelector('.studio-management details').open=true;document.querySelector('.studio-management details').scrollIntoView({block:'center'})",
  );
  await capture("resources-light");
  await click(".studio-back");
  await writeFile(
    join(output, "ui.json"),
    `${JSON.stringify({ kind: "offline rendered UI with real IPC and file services; no model calls", results }, null, 2)}\n`,
  );
}
