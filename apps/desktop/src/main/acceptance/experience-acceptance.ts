import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import type { acceptanceProvider } from "./acceptance-provider.js";

/** Local UI audit through the real renderer/IPC and a controllable loopback SSE stream. */
export async function runExperienceAcceptance(
  window: BrowserWindow,
  output: string,
  provider: Awaited<ReturnType<typeof acceptanceProvider>>,
  mode: string,
  results: unknown[],
) {
  const js = (source: string) => window.webContents.executeJavaScript(source);
  const until = async (expression: string) => {
    console.log("T12 UI wait", expression);
    await js(
      `new Promise((resolve,reject)=>{const deadline=Date.now()+10000;const check=()=>{if(${expression}) resolve(true);else if(Date.now()>deadline)reject(new Error('T12 condition timed out'));else setTimeout(check,40);};check();})`,
    );
  };
  const click = async (selector: string) => {
    await until(
      `document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`,
    );
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const capture = async (name: string) => {
    await js(
      "document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))).then(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))))",
    );
    const metrics = await js(
      `(()=>{const area=document.querySelector('.live-transcript');const control=document.querySelector('[data-testid=stop-active]')??document.querySelector('.studio-composer-footer > button:last-child');const r=control?.getBoundingClientRect();return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,gap:area?area.scrollHeight-area.scrollTop-area.clientHeight:null,controlVisible:Boolean(r&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth),zoom:${window.webContents.getZoomFactor()}}})()`,
    );
    await writeFile(
      join(output, `${name}.png`),
      (await window.webContents.capturePage()).toPNG(),
    );
    results.push({ name, ...metrics, fixture: true, externalProvider: false });
    return metrics;
  };
  window.setContentSize(1100, 728);
  await click('[data-testid="settings"]');
  await js(
    "(()=>{const input=document.querySelector('[data-testid=language]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,'en');input.dispatchEvent(new Event('change',{bubbles:true}));})()",
  );
  await until("document.documentElement.lang==='en'");
  await click(".studio-back");
  provider.setMode("stream");
  await click(".sidebar > button:first-of-type");
  await until(
    "document.querySelector('.studio-welcome') && !document.querySelector('[data-testid=composer-engine]').disabled",
  );
  await js(
    "(()=>{const input=document.querySelector('.live-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'T12 long answer fixture');input.dispatchEvent(new Event('input',{bubbles:true}));})()",
  );
  await click(".studio-composer-footer > button:last-child");
  await until(
    "document.querySelector('.live-transcript')?.textContent.includes('T12 stream fixture start')",
  );
  const paragraphs = Array.from(
    { length: 60 },
    (_, index) =>
      `### Observation ${index + 1}\n\nLocal scripted content for scrolling and reading. 已保存的测试内容，用于验证滚动体验。\n\n`,
  ).join("");
  provider.appendText(paragraphs + "\nT12 initial tail.\n");
  await until(
    "document.querySelector('.live-transcript')?.textContent.includes('T12 initial tail.')",
  );
  const baseline = mode === "baseline";
  const first = await capture(
    baseline ? "01-before-long-stream" : "01-after-long-stream",
  );
  if (!baseline) {
    if (first.gap > 2) throw new Error(`Stream did not follow: ${first.gap}`);
    await js(
      `(()=>{const e=document.querySelector('.live-transcript');e.dispatchEvent(new WheelEvent('wheel',{deltaY:-500,bubbles:true}));e.scrollTop=200;e.dispatchEvent(new Event('scroll'));})()`,
    );
    provider.appendText("\nT12 paused tail.\n");
    await until(
      "document.querySelector('.live-transcript')?.textContent.includes('T12 paused tail.') && document.querySelector('[data-testid=jump-latest]')",
    );
    const paused = await js(
      "document.querySelector('.live-transcript').scrollTop",
    );
    if (Math.abs(paused - 200) > 2)
      throw new Error(`Reading position moved: ${paused}`);
    await capture("02-paused-reading");
    await click('[data-testid="jump-latest"]');
    const followed = await capture("03-resumed-following");
    if (followed.gap > 2) throw new Error("Jump failed");
    for (let n = 0; n < 100; n++) provider.appendText(` stress-${n} `);
    provider.appendText(
      '\n\n```tsx\nconst value = "T12 exact code";\n```\n\n| key | value |\n|---|---|\n| fixture | local |\n\nT12 final tail.',
    );
    await until(
      "document.querySelector('.live-transcript')?.textContent.includes('T12 final tail.')",
    );
  }
  provider.finishText();
  await until(
    "document.querySelector('[data-run-result=current]') && !document.querySelector('[data-testid=composer-engine]').disabled",
  );
  await capture(
    baseline ? "02-before-completed-answer" : "02-after-completed-answer",
  );
  window.webContents.setZoomFactor(2);
  await until("innerWidth < 600");
  const zoom = await capture(
    baseline ? "03-before-zoom-200" : "03-after-zoom-200",
  );
  window.webContents.setZoomFactor(1);
  if (!baseline) {
    if (zoom.overflow || !zoom.controlVisible)
      throw new Error("200% zoom controls inaccessible");
    await js(
      `(()=>{window.__t12Clipboard=Object.getOwnPropertyDescriptor(navigator,'clipboard');Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__t12Copied=text;}}});})()`,
    );
    try {
      await click(".live-answer:last-of-type .message-actions button");
      const answer = await js("window.__t12Copied");
      for (let n = 0; n < 100; n++) {
        if (answer.split(` stress-${n} `).length !== 2)
          throw new Error(`Chunk lost or duplicated: ${n}`);
      }
      await click(".live-answer:last-of-type .code-block button");
      if (
        (await js("window.__t12Copied")) !== 'const value = "T12 exact code";'
      )
        throw new Error("Code copy changed content");
    } finally {
      await js(
        "(()=>{if(window.__t12Clipboard)Object.defineProperty(navigator,'clipboard',window.__t12Clipboard);else delete navigator.clipboard;delete window.__t12Copied;delete window.__t12Clipboard;})()",
      );
    }
    for (const locale of ["en", "zh-CN"]) {
      for (const appearance of ["light", "dark"]) {
        await click('[data-testid="settings"]');
        await js(
          `(()=>{const e=document.querySelector('[data-testid=language]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(locale)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
        );
        await click(
          `.theme-options button:nth-child(${appearance === "light" ? 1 : 2})`,
        );
        await click(".studio-back");
        for (const width of [1100, 840]) {
          window.setContentSize(width, 728);
          for (const factor of [1, 2]) {
            window.webContents.setZoomFactor(factor);
            await until(`Math.abs(innerWidth-${width / factor})<2`);
            const entry = await capture(
              `matrix-${locale}-${appearance}-${width}-${factor * 100}`,
            );
            if (entry.overflow || !entry.controlVisible)
              throw new Error(
                `Matrix controls inaccessible: ${locale}/${appearance}/${width}/${factor}`,
              );
          }
        }
        window.webContents.setZoomFactor(1);
        window.setContentSize(1100, 728);
      }
    }
    provider.setMode("approval");
    await click(".sidebar > button:first-of-type");
    await until(
      "document.querySelector('.studio-welcome') && !document.querySelector('[data-testid=composer-engine]').disabled",
    );
    await js(
      "(()=>{const e=document.querySelector('.live-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'T12 keyboard approval');e.dispatchEvent(new Event('input',{bubbles:true}));e.focus();e.setSelectionRange(e.value.length,e.value.length);})()",
    );
    const callsBeforeIme = provider.calls;
    await js(
      "document.querySelector('.live-composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}))",
    );
    if (provider.calls !== callsBeforeIme)
      throw new Error("Composition Enter submitted");
    window.webContents.sendInputEvent({
      type: "keyDown",
      keyCode: "Enter",
      modifiers: ["shift"],
    });
    window.webContents.sendInputEvent({
      type: "char",
      keyCode: "\r",
      modifiers: ["shift"],
    });
    window.webContents.sendInputEvent({
      type: "keyUp",
      keyCode: "Enter",
      modifiers: ["shift"],
    });
    await until(
      "document.querySelector('.live-composer textarea').value.endsWith('\\n')",
    );
    if (provider.calls !== callsBeforeIme)
      throw new Error("Shift+Enter submitted");
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
    await until("document.querySelector('.run-approval')");
    window.webContents.setZoomFactor(2);
    await until("innerWidth < 600");
    await js("document.querySelector('.run-approval-details').open=true");
    await until(
      "(()=>{const r=document.querySelector('.run-approval footer').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()",
    );
    await capture("approval-zoom-200");
    await js(
      "document.querySelector('.run-approval button:last-child').focus()",
    );
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
    window.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
    await until(
      "!document.querySelector('.run-approval') && !document.querySelector('[data-testid=composer-engine]').disabled",
    );
    await until(
      "document.activeElement === document.querySelector('.live-composer textarea')",
    );
    await capture("approval-completed-zoom-200");
    window.webContents.setZoomFactor(1);
    results.push({
      name: "t12-keyboard-approval",
      enterSend: true,
      shiftEnterNewline: true,
      syntheticImeGuard: true,
      approvalZoom: 200,
      focusRestored: true,
    });
    window.webContents.debugger.attach("1.3");
    try {
      await window.webContents.debugger.sendCommand(
        "Emulation.setEmulatedMedia",
        { features: [{ name: "prefers-reduced-motion", value: "reduce" }] },
      );
      const reduced = await js(
        "matchMedia('(prefers-reduced-motion: reduce)').matches",
      );
      const tree = await window.webContents.debugger.sendCommand(
        "Accessibility.getFullAXTree",
      );
      await writeFile(
        join(output, "accessibility.json"),
        JSON.stringify(tree, null, 2),
      );
      if (!reduced) throw new Error("Reduced motion emulation failed");
      await capture("reduced-motion");
      results.push({
        name: "t12-stream-copy-accessibility",
        chunks: 100,
        exactCopy: true,
        reducedMotion: true,
        screenReaderSpeechVerified: false,
        nativeImeVerified: false,
      });
    } finally {
      window.webContents.debugger.detach();
    }
  }
  results.push({
    name: baseline ? "t12-baseline" : "t12-experience",
    firstGap: first.gap,
    zoomOverflow: zoom.overflow,
    fixture: true,
    externalProvider: false,
  });
}
