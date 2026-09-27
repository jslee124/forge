import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import type { UpdateStatus } from "../shared/update-protocol.js";
import type { UpdateService } from "./update-service.js";

/** Explicit offline UI fixtures; never used by normal startup or real release checks. */
export async function runUpdateUiAcceptance(
  window: BrowserWindow,
  updates: UpdateService,
  output: string,
): Promise<void> {
  await mkdir(output, { recursive: true });
  const js = (code: string) => window.webContents.executeJavaScript(code);
  const wait = async (condition: string) =>
    js(
      `new Promise((resolve, reject) => { const deadline = Date.now() + 10000; const poll = () => { if (${condition}) resolve(true); else if(Date.now() > deadline) reject(new Error('Update UI timeout: ' + ${JSON.stringify(condition)})); else setTimeout(poll, 40); }; poll(); })`,
    );
  const click = async (selector: string) => {
    await wait(`document.querySelector(${JSON.stringify(selector)})`);
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  await wait(
    "document.querySelector('.sidebar > button') && !document.querySelector('.sidebar > button').disabled",
  );
  await click(".sidebar > button");
  await wait("!document.querySelector('.sidebar > button').disabled");
  await wait("document.querySelector('.live-composer textarea')");
  await js(
    `{ const input = document.querySelector('.live-composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Update QA retained draft'); input.dispatchEvent(new Event('input', {bubbles:true})); }`,
  );
  await wait(
    "document.querySelector('.live-composer textarea').value === 'Update QA retained draft'",
  );
  await click('[data-testid="settings"]');
  const evidence: unknown[] = [];
  for (const theme of ["light", "dark"]) {
    await click(
      `.theme-options button:nth-child(${theme === "light" ? 1 : 2})`,
    );
    for (const language of ["en", "zh-CN"]) {
      await js(
        `{const e = document.querySelector('[data-testid=language]'); e.value = ${JSON.stringify(language)}; e.dispatchEvent(new Event('change', {bubbles:true}));}`,
      );
      await wait(
        `document.documentElement.lang === ${JSON.stringify(language)}`,
      );
      await click(".settings-nav button:nth-child(4)");
      for (const phase of [
        "unchecked",
        "checking",
        "current",
        "available",
        "downloading",
        "verifying",
        "verified",
        "failed",
      ] as UpdateStatus["phase"][]) {
        updates.status = {
          version: "0.3.4-preview.1",
          platform: "darwin",
          channel: "preview",
          startup: false,
          phase,
          target: "0.3.4-preview.2",
          notes: "Offline update UI fixture <script>not executable</script>",
          received: 52428800,
          total:
            phase === "downloading" && theme === "light"
              ? 100000000
              : undefined,
          error: phase === "failed" ? "Fixture: SHA-256 mismatch" : undefined,
          retry: phase === "failed" ? "download" : undefined,
        };
        await new Promise((resolve) => setTimeout(resolve, 850));
        const name = `${theme}-${language}-${phase}`;
        await js(
          "document.querySelector('#settings-updates').scrollIntoView({block:'start'})",
        );
        const metrics = await js(
          `({overflow: document.documentElement.scrollWidth > innerWidth, settings: !!document.querySelector('[data-testid=settings]'), focusable: [...document.querySelectorAll('#settings-updates button')].every(b => b.tabIndex >= 0), notesSafe: !document.querySelector('#settings-updates script')})`,
        );
        if (metrics.overflow || !metrics.focusable || !metrics.notesSafe)
          throw new Error(`Update UI failed: ${name}`);
        await writeFile(
          join(output, `${name}.png`),
          (await window.webContents.capturePage()).toPNG(),
        );
        evidence.push({ name, ...metrics });
      }
      window.setSize(720, 600);
      await click('[data-testid="sidebar-toggle"]');
      await new Promise((resolve) => setTimeout(resolve, 200));
      const settingsSelector =
        process.platform === "darwin"
          ? ".studio-toolbar-settings"
          : '[data-testid="settings"]';
      await click(".settings-nav button:nth-child(4)");
      const compact = await js(
        `{const settings = document.querySelector(${JSON.stringify(settingsSelector)}); settings.focus(); ({focus: document.activeElement === settings, settingsVisible: settings.getBoundingClientRect().width > 0, accessibleAction: !!document.querySelector('#settings-updates button'), sidebarHidden: ${process.platform === "darwin"} ? getComputedStyle(document.querySelector('.sidebar')).display === 'none' : true, overflow: document.documentElement.scrollWidth > innerWidth});}`,
      );
      if (
        !compact.focus ||
        !compact.settingsVisible ||
        !compact.accessibleAction ||
        !compact.sidebarHidden ||
        compact.overflow
      )
        throw new Error("Collapsed update controls inaccessible");
      await writeFile(
        join(output, `${theme}-${language}-collapsed.png`),
        (await window.webContents.capturePage()).toPNG(),
      );
      evidence.push({ name: `${theme}-${language}-collapsed`, ...compact });
      await click(
        process.platform === "darwin"
          ? '.live-toolbar [data-testid="sidebar-toggle"]'
          : '[data-testid="sidebar-toggle"]',
      );
      window.setSize(1100, 760);
      await click(".settings-nav button:first-child");
    }
  }
  await click('[data-testid="settings"]');
  await wait(
    "document.querySelector('.live-composer textarea')?.value === 'Update QA retained draft'",
  );
  const draftGuard = await js(
    "(() => { const event = new Event('beforeunload', {cancelable:true}); window.dispatchEvent(event); return event.defaultPrevented; })()",
  );
  if (!draftGuard) throw new Error("Updates bypassed draft exit guard");
  evidence.push({
    name: "draft-retention-and-exit-guard",
    retained: true,
    draftGuard,
  });
  await writeFile(
    join(output, "results.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
}
