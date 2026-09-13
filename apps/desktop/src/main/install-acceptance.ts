import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { access, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FileSessionStore, recordRunInSession } from "@forge/persistence";
import { app, type BrowserWindow } from "electron";
import type { AgentProcess } from "./agent-process.js";
import type { FileService } from "./file-service.js";

/** Opt-in installed-app probe. Uses only an explicitly supplied isolated home. */
export async function runInstallAcceptance(
  window: BrowserWindow,
  agent: AgentProcess,
  files: FileService,
  home: string,
): Promise<Record<string, unknown>> {
  assert(app.isPackaged, "Installation probe requires a packaged application");
  const health = await agent.ping();
  assert(health.resourcesAvailable);
  const state = await agent.management.request({ type: "state" });
  assert.equal(await realpath(state.forgeHome), await realpath(home));
  const cwd = join(home, "中文 workspace");
  await mkdir(cwd, { recursive: true });
  await agent.management.request({ type: "workspace", cwd });
  const canonical = await realpath(cwd);
  const store = new FileSessionStore(home);
  const snapshot = recordRunInSession(
    store.create({ root: canonical, cwd: canonical }),
    {
      prompt: "D13 installed fixture",
      finalText: "Installed PDF acceptance",
      status: "completed",
      runId: randomUUID(),
    },
  );
  await store.save(snapshot);
  const created = await agent.management.request({
    type: "resume",
    sessionId: snapshot.id,
  });
  assert(created.sessionId);
  await files.setWorkspace(cwd);
  const installed = await agent.management.request({ type: "web-install" });
  assert(installed.web?.installed);
  const enabled = await agent.management.request({
    type: "web-enable",
    enabled: true,
  });
  assert(enabled.web?.enabled);
  for (const name of ["cmaps", "standard_fonts", "wasm"])
    await access(join(process.resourcesPath, "pdfjs", name));
  const stream = "BT /F1 12 Tf 30 72 Td (D13 installed PDF) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await writeFile(join(cwd, "sample.pdf"), pdf);
  const preview = await files.preview({ path: "sample.pdf" });
  assert(preview.document.kind === "pdf");
  assert(preview.document.pages[0]?.text.includes("D13 installed PDF"));
  const auth = await agent.management.request({ type: "auth-status" });
  const js = (code: string) => window.webContents.executeJavaScript(code);
  await js(
    `window.forgeDesktop.manage({type:'resume',sessionId:${JSON.stringify(created.sessionId)}})`,
  );
  window.webContents.reload();
  await js(`new Promise(resolve => setTimeout(resolve, 500))`).catch(
    () => undefined,
  );
  await js(
    `new Promise((resolve,reject) => { let n=0; const poll=()=> { const input=document.querySelector('[data-testid=file-path]'); if(input) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'sample.pdf'); input.dispatchEvent(new Event('input',{bubbles:true})); resolve(true); } else if(n++>200) reject(new Error('No file control')); else setTimeout(poll,50); }; poll(); })`,
  );
  await js(`new Promise(resolve=>setTimeout(resolve,100))`);
  await js(`document.querySelector('[data-testid=preview-file]').click()`);
  await js(
    `new Promise((resolve,reject)=>{let n=0; const poll=()=>{const c=document.querySelector('.pdf-preview canvas'); if(c && c.width===375 && document.querySelector('.pdf-preview').textContent.includes('D13 installed PDF')) resolve(true); else if(n++>200) reject(new Error('PDF did not render')); else setTimeout(poll,50);};poll();})`,
  );
  await js(`new Promise(resolve=>setTimeout(resolve,300))`);
  assert.equal(
    await js(`Boolean(document.querySelector('.pdf-preview .field-error'))`),
    false,
  );
  await writeFile(
    join(home, "installed-pdf.png"),
    (await window.webContents.capturePage()).toPNG(),
  );
  const { PATH, HTTPS_PROXY, https_proxy, HTTP_PROXY, http_proxy } =
    process.env;
  return {
    observedAt: new Date().toISOString(),
    packaged: app.isPackaged,
    arch: process.arch,
    versions: process.versions,
    appVersion: app.getVersion(),
    path: PATH,
    forgeHomeMatched: true,
    proxyConfigured: Boolean(
      HTTPS_PROXY || https_proxy || HTTP_PROXY || http_proxy,
    ),
    agentPid: health.pid,
    resources: true,
    pluginInstalled: true,
    pluginEnabled: true,
    pdfText: true,
    pdfCanvas: true,
    auth: auth.auth,
    chineseWorkspace: true,
    sessionResume: true,
    modelCalls: 0,
  };
}
