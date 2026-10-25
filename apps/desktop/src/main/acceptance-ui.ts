import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FileSessionStore, recordRunInSession } from "@forge/persistence";
import { app, type BrowserWindow, dialog } from "electron";
import { acceptanceProvider } from "./acceptance-provider.js";
import { runExperienceAcceptance } from "./experience-acceptance.js";

/** Explicit development acceptance fixture; never invokes a model or fabricates provider evidence. */
export async function runUiAcceptance(
  window: BrowserWindow,
  home: string,
  output: string,
): Promise<void> {
  window.webContents.setZoomFactor(1);
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
          `document.querySelector('.live-transcript')?.textContent.includes('D12 ${f.kind}') && !document.querySelector('[data-testid=composer-engine]').disabled`,
        );
        // Each conversation now restores its own panel visibility instead of forcing it open.
        if (!(await js("Boolean(document.querySelector('.live-panel'))")))
          await click(".studio-panel-toggle");
        await click(".studio-tabs button:first-child");
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
  await until("document.querySelector('.app-shell.sidebar-collapsed')");
  await js(
    `(() => { const toolbar = document.querySelector('.live-toolbar'); const toggle = toolbar.querySelector('[data-testid=sidebar-toggle]'); if (getComputedStyle(document.querySelector('.sidebar')).display !== 'none') throw new Error('Collapsed sidebar remains visible'); if (!toolbar.querySelector('.studio-toolbar-new-task') || !toolbar.querySelector('.studio-toolbar-settings')) throw new Error('Collapsed toolbar controls missing'); if (toggle.getBoundingClientRect().left < 96) throw new Error('Sidebar toggle overlaps the native traffic lights'); if ([...document.querySelectorAll('.studio-square-mark')].some(el => el.getClientRects().length)) throw new Error('Collapsed macOS sidebar mark remains visible'); if (document.querySelector('.live-main').getBoundingClientRect().left !== 0) throw new Error('Collapsed sidebar has not released its width'); })()`,
  );
  await capture("home-dark-collapsed");
  await click(".studio-toolbar-settings");
  await until("document.querySelector('.live-settings')");
  await capture("settings-dark-collapsed");
  await click(".studio-toolbar-settings");
  await until("document.querySelector('.studio-welcome')");
  await click('.live-toolbar [data-testid="sidebar-toggle"]');
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
  await until("document.querySelector('.app-shell.sidebar-collapsed')");
  await capture("home-light-collapsed");
  window.setContentSize(720, 600);
  await capture("home-light-collapsed-narrow");
  await click(".studio-toolbar-new-task");
  await until("document.querySelector('.studio-welcome')");
  window.setContentSize(1100, 728);
  await click('.live-toolbar [data-testid="sidebar-toggle"]');
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
  const originalDialog = dialog.showMessageBoxSync;
  let closePrompts = 0;
  try {
    dialog.showMessageBoxSync = () => {
      closePrompts++;
      return 0;
    };
    window.close();
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (window.isDestroyed() || closePrompts !== 1)
      throw new Error("window close bypassed draft guard");
    app.quit();
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (window.isDestroyed() || Number(closePrompts) !== 2)
      throw new Error("application quit bypassed draft guard");
  } finally {
    dialog.showMessageBoxSync = originalDialog;
  }
  await enterDraft("/resources");
  await js(
    `document.querySelector('.live-composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
  );
  await until(
    "document.querySelector('#settings-extensions .studio-management') && !document.querySelector('.studio-management button').disabled",
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
  // P4: real rendered controls and native modal focus, across locale/theme/width.
  for (const locale of ["zh-CN", "en"]) {
    for (const appearance of ["light", "dark"]) {
      await click('[data-testid="settings"]');
      await js(
        `(() => {const e=document.querySelector('[data-testid=language]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(locale)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await until(
        `document.documentElement.lang === ${JSON.stringify(locale)}`,
      );
      await click(
        `.theme-options button:nth-child(${appearance === "light" ? 1 : 2})`,
      );
      await click(".settings-nav button:nth-child(2)");
      window.setContentSize(840, 800);
      await until(
        "document.querySelector('.studio-management select') && !document.querySelector('.studio-management select').disabled",
      );
      await js(
        "document.querySelector('.studio-management').scrollIntoView({block:'start'})",
      );
      await capture(`p4-${locale}-${appearance}-settings-narrow`);
      await js(
        "(() => {const b=document.querySelector('.studio-management .studio-connection-card > button');b.focus();b.click();})()",
      );
      await until(
        "document.querySelector('dialog[open]') && document.activeElement === document.querySelector('dialog button')",
      );
      await until(
        "(() => {const r=document.querySelector('dialog').getBoundingClientRect();return Math.abs(r.left+r.width/2-innerWidth/2)<2 && Math.abs(r.top+r.height/2-innerHeight/2)<2;})()",
      );
      await capture(`p4-${locale}-${appearance}-confirmation`);
      // Chromium performs actual Tab traversal and modal focus containment.
      window.webContents.sendInputEvent({
        type: "keyDown",
        keyCode: "Tab",
        modifiers: ["shift"],
      });
      window.webContents.sendInputEvent({
        type: "keyUp",
        keyCode: "Tab",
        modifiers: ["shift"],
      });
      await until(
        "document.activeElement === document.querySelector('dialog button:last-child')",
      );
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await until(
        "!document.querySelector('dialog[open]') && document.activeElement === document.querySelector('.studio-management .studio-connection-card > button')",
      );
      await click(".studio-back");
      await until(
        "document.activeElement === document.querySelector('.live-composer textarea')",
      );
      window.setContentSize(1100, 728);
    }
  }
  // P4: real IPC + adapter + harmless pwd approval against a scripted loopback provider.
  const provider = await acceptanceProvider();
  try {
    const model =
      "offline-model-with-an-intentionally-long-name-for-layout-verification";
    await writeFile(
      join(home, "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        model: { engine: "forge", provider: "p4-fixture", id: model },
        providers: {
          "p4-fixture": {
            api: "openai-completions",
            baseUrl: provider.url,
            auth: { type: "none" },
            models: [{ id: model }],
          },
        },
      }),
    );
    await click('[data-testid="settings"]');
    await click(".settings-nav button:nth-child(2)");
    await until(
      "!document.querySelector('.studio-management select').disabled",
    );
    await click(".studio-back");
    await click(".sidebar > button:first-of-type");
    await until(
      "document.querySelector('.studio-welcome') && !document.querySelector('[data-testid=composer-engine]').disabled",
    );
    await enterDraft("P4 offline approval workflow");
    await click(".studio-composer-footer > button:last-child");
    await until("document.querySelector('.run-approval')");
    await until(
      "document.activeElement === document.querySelector('.run-approval button')",
    );
    await capture("p4-approval");
    await js("document.querySelector('.run-approval-details').open = true");
    window.setContentSize(840, 800);
    await until(
      "(() => {const r=document.querySelector('.run-approval footer').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && document.querySelector('.run-approval .run-output');})()",
    );
    await capture("product-approval-details-narrow");
    window.setContentSize(1100, 728);
    const runningSession = await js(
      "window.forgeDesktop.manage({type:'state'}).then(state=>state.sessionId)",
    );
    const browsingFixture = fixtures.find((entry) => entry.kind === "local");
    if (!browsingFixture) throw new Error("Missing read-only browsing fixture");
    const callsBeforeBrowsing = provider.calls;
    await until(
      `document.querySelector('[data-session-id="${runningSession}"] .session-running')`,
    );
    await enterDraft("Draft for running task A");
    await click(`[data-session-id="${browsingFixture.id}"]`);
    await until(
      `document.querySelector('.live-transcript')?.getAttribute('data-view-session') === ${JSON.stringify(browsingFixture.id)}`,
    );
    if (await js("Boolean(document.querySelector('.run-approval'))"))
      throw new Error("Approval leaked into the browsed conversation");
    await enterDraft("Draft for viewed task B");
    await js(
      "document.querySelector('.live-composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))",
    );
    if (provider.calls !== callsBeforeBrowsing)
      throw new Error("Browsing started another model request");
    await until(
      "document.querySelector('.run-navigation')?.textContent.includes('Pending approvals:')",
    );
    await capture("product-browsing-during-approval");
    window.setContentSize(840, 800);
    await until(
      "(() => {const r=document.querySelector('[data-testid=return-active]').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;})()",
    );
    await capture("product-browsing-approval-narrow");
    window.setContentSize(1100, 728);
    await click('[data-testid="return-active"]');
    await until(
      "document.querySelector('.run-approval') && document.querySelector('.run-approval-details').open && document.querySelector('.live-composer textarea').value === 'Draft for running task A'",
    );
    if (
      (await js(
        "window.forgeDesktop.manage({type:'state'}).then(state=>state.sessionId)",
      )) !== runningSession
    )
      throw new Error("Browsing changed the execution session");
    await click(".run-approval button:last-child");
    await until(
      "document.querySelector('.live-transcript')?.textContent.includes('P4 offline fixture completed after approval.') && !document.querySelector('[data-testid=composer-engine]').disabled",
    );
    await capture("p4-completed");
    await js("document.querySelector('.run-activity-disclosure').open = true");
    await until(
      "document.querySelectorAll('.run-activity li').length >= 2 && document.querySelector('.run-activity').textContent.includes('Succeeded')",
    );
    await js("document.querySelector('.run-activity li details').open = true");
    await capture("product-activity-expanded");
    // Persisted history survives a renderer reload; viewing it cannot call the provider.
    const historySession = await js(
      "window.forgeDesktop.manage({type:'state'}).then(state => state.sessionId)",
    );
    const callsBeforeHistory = provider.calls;
    // Earlier fixture drafts intentionally remain unsent. Bypass only the test
    // window's native unload prompt while checking persistence, then restore it.
    const unloadGuards = window.webContents.listeners("will-prevent-unload");
    window.webContents.removeAllListeners("will-prevent-unload");
    window.webContents.once("will-prevent-unload", (event) =>
      event.preventDefault(),
    );
    const reloaded = new Promise<void>((resolve) =>
      window.webContents.once("did-finish-load", () => resolve()),
    );
    window.webContents.reload();
    await reloaded;
    for (const guard of unloadGuards)
      window.webContents.on("will-prevent-unload", (event) => guard(event));
    await click(`[data-session-id="${historySession}"]`);
    await until(
      "document.querySelector('.live-panel') && !document.querySelector('[data-testid=composer-engine]').disabled",
    );
    await click(".studio-tabs button:last-child");
    await until(
      "document.querySelector('.studio-tabs button:last-child').getAttribute('aria-pressed') === 'true'",
    );
    await until(
      "document.querySelector('.run-history li button') && !document.querySelector('.run-history li button').disabled",
    );
    await click(".run-history li button");
    try {
      await until(
        "document.querySelector('.studio-panel-body:not([hidden]) .run-history-selected .run-activity li') && !document.querySelector('.run-history li button').disabled",
      );
    } catch (error) {
      console.error(
        "History diagnostic",
        await js(
          "(async()=>JSON.stringify({panel:document.querySelector('.live-panel')?.textContent,state:await window.forgeDesktop.manage({type:'state'})}))()",
        ),
      );
      await capture("product-history-failure");
      throw error;
    }
    if (
      await js(
        "Boolean(document.querySelector('.run-history-selected .run-approval'))",
      )
    )
      throw new Error("Historical approval became executable");
    if (provider.calls !== callsBeforeHistory)
      throw new Error("History viewing called provider");
    const restoredHistory = await js(
      "window.forgeDesktop.manage({type:'state'}).then(state => state.runHistory)",
    );
    if (
      !restoredHistory?.selected?.activity.items.some(
        (item: { action?: { status: string } }) =>
          item.action?.status === "succeeded",
      )
    )
      throw new Error("Historical action result missing");
    await capture("product-durable-history-after-reload");
    await click(".studio-panel-toggle");
    // Language initializes from the app default after reload; set this fixture explicitly.
    await click('[data-testid="settings"]');
    await click(".settings-nav button:first-child");
    await js(
      "(() => {const e=document.querySelector('[data-testid=language]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'en');e.dispatchEvent(new Event('change',{bubbles:true}));})()",
    );
    await until("document.documentElement.lang === 'en'");
    await click(".studio-back");
    // The conversation container, rather than the window alone, owns responsive controls.
    for (const width of [1100, 980, 840, 720]) {
      window.setContentSize(width, 800);
      for (const panelOpen of [true, false]) {
        await click(".studio-panel-toggle");
        await until(
          `Boolean(document.querySelector('.live-panel')) === ${panelOpen}`,
        );
        const layoutError = await js(`(() => { try {
          const footer = document.querySelector('.studio-composer-footer');
          const bounds = footer.getBoundingClientRect();
          const controls = [...footer.children].filter(e => getComputedStyle(e).display !== 'none');
          const rects = controls.map(e => e.getBoundingClientRect());
          if (rects.some(r => r.left < bounds.left - 1 || r.right > bounds.right + 1)) throw new Error('Composer control outside footer');
          for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i], b = rects[j];
            if (Math.min(a.right,b.right) - Math.max(a.left,b.left) > 1 && Math.min(a.bottom,b.bottom) - Math.max(a.top,b.top) > 1) throw new Error('Overlapping composer groups');
          }
          if ([...footer.querySelectorAll('svg')].filter(e => e.getClientRects().length).some(e => e.getBoundingClientRect().width < 14)) throw new Error('Squeezed composer icon');
          const compact = document.querySelector('.live-main').getBoundingClientRect().width <= 740;
          const engineMark = document.querySelector('.studio-engine-mark');
          if (!engineMark.complete || !engineMark.naturalWidth || engineMark.getBoundingClientRect().width < 18) throw new Error('Engine brand mark missing');
          if (!compact && document.querySelector('[data-testid=composer-model]').getBoundingClientRect().width > 200) throw new Error('Expanded model control stretches too wide');
          if (document.querySelector('[data-testid=composer-model]').getBoundingClientRect().width < (compact ? 34 : 60)) throw new Error('Model selector too narrow');
          if (compact) {
            if ([...footer.querySelectorAll('.studio-control-label,.studio-model-label,.studio-action-label')].some(e => getComputedStyle(e).display !== 'none')) throw new Error('Compact composer retains long labels');
            const centers = rects.map(r => r.top + r.height / 2);
            if (Math.max(...centers) - Math.min(...centers) > 1) throw new Error('Compact composer wraps into multiple rows');
            if (!document.querySelector('[data-testid=composer-model]').title || !document.querySelector('[data-testid=composer-engine]').title) throw new Error('Compact selector lacks tooltip');
          }
          const toolbar = document.querySelector('.live-toolbar').getBoundingClientRect();
          if ([...document.querySelectorAll('.live-toolbar > button')].some(e => e.getBoundingClientRect().top < 10 || e.getBoundingClientRect().bottom > toolbar.bottom + 1)) throw new Error('Toolbar lacks safe top inset');
          const transcript = document.querySelector('.live-transcript');
          const main = document.querySelector('.live-main').getBoundingClientRect();
          const composer = document.querySelector('.live-composer').getBoundingClientRect();
          if (Math.abs(composer.left - main.left - parseFloat(getComputedStyle(transcript).paddingLeft)) > 1) throw new Error('Conversation surfaces misaligned');
          return '';
        } catch(error) { return String(error); } })()`);
        if (layoutError) {
          await capture(
            `layout-failed-${width}-${panelOpen ? "panel" : "conversation"}`,
          );
          throw new Error(`${width}/${panelOpen}: ${layoutError}`);
        }
        await capture(
          `layout-${width}-${panelOpen ? "panel" : "conversation"}`,
        );
      }
    }
    window.setContentSize(1100, 728);
    await click(".studio-panel-toggle");
    window.setContentSize(840, 800);
    await capture("p4-long-model-panel-narrow");
    await click('[data-testid="composer-model"]');
    await until(
      "document.activeElement === document.querySelector('.studio-model-popover input')",
    );
    await capture("p4-long-model-picker-narrow");
    await js(
      "document.querySelector('.studio-model-footer > button:last-of-type').click()",
    );
    await until(
      "document.activeElement === document.querySelector('[data-testid=composer-model]')",
    );
    window.setContentSize(1100, 728);
    await click(".studio-panel-toggle");
    provider.setMode("wait");
    await enterDraft("P4 offline cancellation workflow");
    await click(".studio-composer-footer > button:last-child");
    await until(
      "document.querySelector('.live-transcript')?.textContent.includes('waiting for cancellation')",
    );
    await capture("p4-running");
    await click(".studio-composer-footer > button:last-child");
    await until(
      "!document.querySelector('[data-testid=composer-engine]').disabled",
    );
    await until(
      "document.querySelector('[data-run-result=current]')?.textContent.includes('Run stopped')",
    );
    await capture("p4-stopped");
    provider.setMode("error");
    await enterDraft("P4 offline error workflow");
    await click(".studio-composer-footer > button:last-child");
    await until(
      "!document.querySelector('[data-testid=composer-engine]').disabled && document.querySelector('[data-run-result=current][role=alert]')",
    );
    await until(
      "(() => {const r=document.querySelector('[data-run-result=current]').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight;})()",
    );
    await capture("p4-error");
    const finalizationCallsBefore = provider.calls;
    const finalizationConfig = JSON.parse(
      await readFile(join(home, "config.json"), "utf8"),
    );
    await writeFile(
      join(home, "config.json"),
      JSON.stringify({
        ...finalizationConfig,
        limits: { ...finalizationConfig.limits, maxSteps: 2 },
      }),
    );
    provider.setMode("finalize");
    await click(".sidebar > button:first-of-type");
    await until(
      "document.querySelector('.studio-welcome') && !document.querySelector('[data-testid=composer-engine]').disabled",
    );
    await enterDraft("P4 bounded finalization fixture");
    await click(".studio-composer-footer > button:last-child");
    try {
      await until(
        "document.querySelector('[data-run-result=current]')?.textContent.includes('Partial result based on available evidence') && document.querySelector('.live-transcript')?.textContent.includes('Partial fixture summary') && !document.querySelector('[data-testid=composer-engine]').disabled",
      );
    } catch (error) {
      console.error(
        "Finalization fixture diagnostic",
        provider.calls,
        provider.noneRequests,
        await js(
          "(async()=>JSON.stringify({text:document.querySelector('.live-main')?.textContent,history:(await window.forgeDesktop.manage({type:'state'})).runHistory}))()",
        ),
      );
      await capture("product-finalization-failure");
      throw error;
    }
    if (
      provider.calls - finalizationCallsBefore !== 2 ||
      provider.noneRequests !== 1
    )
      throw new Error(
        "Finalization exceeded its two-call budget or omitted toolChoice none",
      );
    const partial = await js(
      "window.forgeDesktop.manage({type:'state'}).then(state=>state.runHistory?.selected?.summary.completion)",
    );
    if (
      partial?.outcome !== "limit_reached" ||
      partial.partial !== true ||
      partial.modelSteps !== 2 ||
      partial.toolCalls !== 1
    )
      throw new Error("Partial finalization metadata was lost");
    await capture("product-budget-finalization");
    results.push({
      name: "reserved-finalization",
      calls: 2,
      tools: 1,
      partial: true,
      externalProvider: false,
    });
    const recoveryCallsBefore = provider.calls;
    const recoveryToolFreeBefore = provider.toolFreeRequests;
    await enterDraft("Keep this next task draft");
    await click("[data-run-result=current] [data-recovery=summarize]");
    await until(
      "document.querySelector('dialog[open] .recovery-plan-metadata')",
    );
    if (provider.calls !== recoveryCallsBefore)
      throw new Error("Recovery started before review confirmation");
    await capture("product-recovery-review");
    window.setContentSize(840, 600);
    await until(
      "(() => {const r=document.querySelector('dialog .studio-confirmation-actions').getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth;})()",
    );
    await capture("product-recovery-review-narrow");
    window.setContentSize(1100, 728);
    await click("dialog .studio-confirmation-actions button:last-child");
    await until(
      "document.querySelector('[data-run-result=current]')?.textContent.includes('Existing-information summary') && !document.querySelector('[data-recovery=summarize]').disabled",
    );
    const summaryRecovery = await js(
      "window.forgeDesktop.manage({type:'state'}).then(state=>state.runHistory?.selected?.summary)",
    );
    if (
      provider.calls - recoveryCallsBefore !== 1 ||
      provider.toolFreeRequests - recoveryToolFreeBefore !== 1 ||
      summaryRecovery?.recovery?.kind !== "summarize" ||
      summaryRecovery?.completion?.toolCalls !== 0 ||
      (await js("document.querySelector('.live-composer textarea').value")) !==
        "Keep this next task draft"
    ) {
      console.error(
        "Recovery diagnostic",
        JSON.stringify({
          calls: provider.calls - recoveryCallsBefore,
          toolFree: provider.toolFreeRequests - recoveryToolFreeBefore,
          summaryRecovery,
          draft: await js(
            "document.querySelector('.live-composer textarea').value",
          ),
        }),
      );
      await capture("product-recovery-failure");
      throw new Error(
        "Summary recovery lost its bounded scope, source link or draft",
      );
    }
    await capture("product-recovery-summary");
    await click("[data-run-result=current] > button");
    await until(
      "document.querySelector('.run-history-selected [data-recovery=retry]:not(:disabled)')",
    );
    await click(".run-history-selected [data-recovery=retry]");
    await until("document.querySelector('dialog[open]')");
    await click("dialog .studio-confirmation-actions button:first-child");
    if (
      (await js("document.querySelector('.live-composer textarea').value")) !==
      "Keep this next task draft"
    )
      throw new Error("Cancelled recovery replaced the next draft");
    await click(".run-history-selected [data-recovery=retry]");
    await until("document.querySelector('dialog[open]')");
    await click("dialog .studio-confirmation-actions button:last-child");
    await until("document.querySelector('.run-retry-draft')");
    if (
      (await js("document.querySelector('.live-composer textarea').value")) !==
      "P4 bounded finalization fixture"
    )
      throw new Error("Retry did not load the original source prompt");
    await enterDraft("P4 edited retry fixture");
    await click(".studio-composer-footer > button:last-child");
    await until(
      "document.querySelector('[data-run-result=current]') && !document.querySelector('[data-testid=composer-engine]').disabled",
    );
    const retried = await js(
      "window.forgeDesktop.manage({type:'state'}).then(state=>state.runHistory?.selected?.summary)",
    );
    if (
      retried?.recovery?.kind !== "retry" ||
      retried?.recovery?.sourceRunId !==
        summaryRecovery?.recovery?.sourceRunId ||
      retried?.prompt !== "P4 edited retry fixture"
    )
      throw new Error("Edited retry lost its source link");
    await capture("product-recovery-retry");
    results.push({
      name: "reviewed-recovery",
      summaryCalls: 1,
      summaryTools: 0,
      linkedRetry: true,
      draftPreserved: true,
      externalProvider: false,
    });
    const deliveryConfig = JSON.parse(
      await readFile(join(home, "config.json"), "utf8"),
    );
    await writeFile(
      join(home, "config.json"),
      JSON.stringify({
        ...deliveryConfig,
        limits: { ...deliveryConfig.limits, maxSteps: 5 },
      }),
    );
    provider.setMode("delivery");
    await click(".sidebar > button:first-of-type");
    await until(
      "document.querySelector('.studio-welcome') && !document.querySelector('[data-testid=composer-engine]').disabled",
    );
    await enterDraft("Recorded delivery fixture");
    const beforeDeliveryCalls = provider.calls;
    await click(".studio-composer-footer > button:last-child");
    await until("document.querySelector('.run-approval')");
    await click(".run-approval button:last-child");
    await until(
      "document.querySelector('.run-approval')?.textContent.includes('node')",
    );
    await click(".run-approval button:last-child");
    await until(
      "document.querySelector('[data-run-result=current]') && !document.querySelector('[data-testid=composer-engine]').disabled && document.querySelector('.run-delivery')",
    );
    const deliveryState = await js(
      "window.forgeDesktop.manage({type:'state'}).then(state=>state.runHistory.selected)",
    );
    if (
      provider.calls - beforeDeliveryCalls !== 3 ||
      deliveryState?.delivery?.commands[0]?.facts.exitCode !== 1 ||
      deliveryState?.delivery?.files[0]?.facts.path !== "delivery.txt"
    )
      throw new Error(
        "Delivery lost the recorded write or actual nonzero exit",
      );
    await js(
      "document.querySelector('.run-delivery').open=true; document.querySelector('.run-delivery-files details').open=true",
    );
    await capture("product-delivery-current");
    await js(
      "document.querySelector('.run-delivery-command-output').open=true; document.querySelector('.run-delivery-commands').scrollIntoView({block:'nearest'})",
    );
    await until(
      "document.querySelector('.run-delivery-command-output')?.textContent.includes('Fixture verification failed')",
    );
    await capture("product-delivery-command-result");
    const deliveryWorkspace = await js(
      "window.forgeDesktop.manage({type:'state'}).then(state=>state.cwd)",
    );
    await writeFile(
      join(deliveryWorkspace, "delivery.txt"),
      "Later unrelated edit\n",
    );
    await click(".run-delivery-files button");
    await until(
      "document.querySelector('.studio-panel-body:not([hidden])')?.textContent.includes('Later unrelated edit')",
    );
    await capture("product-delivery-current-preview");
    const deliveryUnloadGuards = window.webContents.listeners(
      "will-prevent-unload",
    );
    window.webContents.removeAllListeners("will-prevent-unload");
    window.webContents.once("will-prevent-unload", (event) =>
      event.preventDefault(),
    );
    const deliveryReloaded = new Promise<void>((resolve) =>
      window.webContents.once("did-finish-load", () => resolve()),
    );
    window.webContents.reload();
    await deliveryReloaded;
    for (const guard of deliveryUnloadGuards)
      window.webContents.on("will-prevent-unload", (event) => guard(event));
    await click(`[data-session-id="${deliveryState.summary.sessionId}"]`);
    await until(
      "document.querySelector('.live-panel') && !document.querySelector('[data-testid=composer-engine]').disabled",
    );
    await click(".studio-tabs button:last-child");
    await click(".run-history li:first-child button");
    await until(
      "document.querySelector('.run-history-selected .run-delivery')",
    );
    await js(
      "document.querySelector('.run-history-selected .run-delivery').open=true; document.querySelector('.run-history-selected .run-delivery-files details').open=true",
    );
    await until(
      "document.querySelector('.run-history-selected [data-command-outcome=nonzero] strong')?.textContent.includes('1')",
    );
    if (
      !(await js(
        "document.querySelector('.run-history-selected .run-delivery-patch')?.textContent.includes('Recorded delivery fixture')",
      ))
    )
      throw new Error(
        "Historical patch was replaced by current workspace content",
      );
    window.setContentSize(840, 800);
    await js(
      "document.querySelector('.run-history-selected .run-delivery > summary').scrollIntoView({block:'center'})",
    );
    await until(
      "(() => {const r=document.querySelector('.run-history-selected .run-delivery > summary').getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight;})()",
    );
    await capture("product-delivery-history-narrow");
    if (provider.calls - beforeDeliveryCalls !== 3)
      throw new Error("Viewing delivery replayed execution");
    results.push({
      name: "recorded-delivery",
      calls: 3,
      exitCode: 1,
      recordedPatchPreserved: true,
      previewCurrentFile: true,
      historyAfterReload: true,
      externalProvider: false,
    });
    if (process.env["FORGE_T12_MODE"])
      await runExperienceAcceptance(
        window,
        output,
        provider,
        process.env["FORGE_T12_MODE"],
        results,
      );
    if (provider.calls < 4) throw new Error("offline transport not exercised");
    results.push({
      name: "independent-browsing",
      executionSessionUnchanged: true,
      draftPreserved: true,
      approvalReturned: true,
      stopFromOtherSession: true,
      noReadReplay: true,
      externalProvider: false,
    });
    results.push({
      name: "p4-loopback-workflow",
      calls: provider.calls,
      fixture: true,
      externalProvider: false,
    });
  } finally {
    await provider.close();
  }
  await writeFile(
    join(output, "ui.json"),
    `${JSON.stringify({ kind: "offline rendered UI with real IPC and file services; no model calls", results }, null, 2)}\n`,
  );
}
