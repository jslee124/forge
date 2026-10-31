import { execFile } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

// Independent behavioral probes live outside model-visible workspaces. They are
// bounded examples, not proof over every input or an OS execution sandbox.
const probes = {
  D02: `
    const {actualTool}=await import(new URL('mock-implementation.mjs',mainUrl));
    const {mockTool}=await import(new URL('mock.mjs',mainUrl));
    check(()=>assert.deepEqual(actualTool(),{value:'ok'}));
    check(()=>assert.deepEqual(mockTool(),actualTool()));
  `,
  E01: `
    for (const value of ['1','8080','65535']) check(()=>assert.equal(w.parsePort(value),Number(value)));
    for (const value of ['0','65536','1.5','1e2','+80','-1','Infinity','NaN','',' ',' 80','80 ','0x50','65535.0',null,undefined,1,[],{}]) check(()=>assert.throws(()=>w.parsePort(value)));
  `,
  E02: `
    for (const user of [{}, {fontSize:16,extra:{kept:true}}, {theme:'dark',fontSize:18}, {theme:'light'}, {theme:'system'}]) {
      const original=structuredClone(user); const result=w.theme(user);
      check(()=>assert.equal(result.theme,user.theme ?? 'system'));
      check(()=>assert.deepEqual(user,original));
      check(()=>assert.deepEqual({...result,theme:undefined},{...original,theme:undefined}));
    }
  `,
  E03: `
    let calls=0; let release;
    const gate=new Promise(resolve=>{release=resolve});
    const first=w.submit(async()=>{calls++;await gate});
    const duplicate=Promise.resolve(w.submit(async()=>{calls++})).catch(()=>undefined);
    await new Promise(resolve=>setTimeout(resolve,10));
    check(()=>assert.equal(calls,1)); release(); await first; await duplicate;
    await w.submit(async()=>{calls++});check(()=>assert.equal(calls,2));
    const failure=new Error('fixture failure');
    let caught;try{await w.submit(async()=>{throw failure})}catch(error){caught=error}
    check(()=>assert.equal(caught,failure));
    await w.submit(async()=>{calls++});check(()=>assert.equal(calls,3));
  `,
  E04: `
    for(const value of ['file.txt','dir with spaces/file name.txt',' leading/file ']) check(()=>assert.equal(w.relativePath(value),value));
    for(const value of ${JSON.stringify(["../secret", "a/../../secret", "/absolute", "C:\\x", "a\\..\\secret", "\\\\server\\share", null, undefined, 1])}) check(()=>assert.throws(()=>w.relativePath(value)));
  `,
  E05: `
    const failure=new Error('async rejection');
    await checkAsync(()=>assert.rejects(()=>w.propagate(async()=>{throw failure}),error=>error===failure));
    const success=await w.propagate(async()=>42);check(()=>assert.equal(success,42));
    const object={same:true};const result=await w.propagate(async()=>object);check(()=>assert.equal(result,object));
  `,
  E06: `
    check(()=>assert.deepEqual(w.dispatch('one'),{operationId:'one'}));
    let seen;const result=await w.handle('two',async input=>{seen=input;return 'ok'});
    check(()=>assert.deepEqual(seen,{operationId:'two'}));check(()=>assert.equal(result,'ok'));
    const main=await import(mainUrl);let received;
    await main.receive('three',input=>{received=input});
    check(()=>assert.deepEqual(received,{operationId:'three'}));
    for(const name of ['workflow.mjs','main.mjs'])check(()=>assert.doesNotMatch(awaitedFiles[name],/\\brequestId\\b/));
  `,
};
export async function checkProductEdit(
  task,
  workspace,
  home,
  probeVersion = "edit-probes-v1",
) {
  if (!["edit-probes-v1", "edit-probes-v2"].includes(probeVersion))
    throw new Error("Unknown independent edit probe version");
  if (!Object.hasOwn(probes, task))
    throw new Error("No independent edit probe");
  // v1 rejected a contained a\\..\\secret path despite the workspace-containment
  // contract. Keep it for historical replay; v2 tests actual root escapes and
  // also requires contained normalization to preserve the original path value.
  const probe =
    task === "E04" && probeVersion === "edit-probes-v2"
      ? `
    for(const value of ${JSON.stringify(["file.txt", "dir with spaces/file name.txt", " leading/file ", "a/../file.txt", "a\\..\\secret"])}) check(()=>assert.equal(w.relativePath(value),value));
    for(const value of ${JSON.stringify(["../secret", "a/../../secret", "/absolute", "C:\\x", "a\\..\\..\\secret", "\\\\server\\share", null, undefined, 1])}) check(()=>assert.throws(()=>w.relativePath(value)));
  `
      : probes[task];
  const prelude = `
    import assert from 'node:assert/strict';
    import {readFile} from 'node:fs/promises';
    import * as w from ${JSON.stringify(pathToFileURL(join(workspace, "workflow.mjs")).href)};
    const mainUrl=${JSON.stringify(pathToFileURL(join(workspace, "main.mjs")).href)};
    const awaitedFiles={};
    for(const name of ['workflow.mjs','main.mjs'])awaitedFiles[name]=await readFile(new URL(name,${JSON.stringify(pathToFileURL(`${workspace}/`).href)}),'utf8');
    let assertions=0;const failures=[];
    function check(fn){assertions++;try{fn()}catch(error){failures.push({assertion:assertions,message:String(error.message).slice(0,1000)})}}
    async function checkAsync(fn){assertions++;try{await fn()}catch(error){failures.push({assertion:assertions,message:String(error.message).slice(0,1000)})}}
    try{${probe}}catch(error){failures.push({stage:'probe',message:String(error.message).slice(0,1000)})}
    console.log(JSON.stringify({status:failures.length?'failed':'passed',assertions,failures,probeVersion:${JSON.stringify(probeVersion)},scope:'bounded independent behavioral probes'}));
  `;
  try {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--input-type=module", "--eval", prelude],
      {
        cwd: workspace,
        timeout: 10000,
        maxBuffer: 65536,
        env: { PATH: process.env.PATH ?? "", HOME: home },
      },
    );
    return JSON.parse(stdout.trim());
  } catch {
    return {
      status: "failed",
      assertions: null,
      probeVersion,
      failures: [
        {
          stage: "process",
          message: "Probe import, execution, timeout or result decoding failed",
        },
      ],
      scope: "bounded independent behavioral probes",
    };
  }
}
