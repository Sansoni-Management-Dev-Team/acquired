import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
it('native Node observes malformed async callback result fields instead of leaking a process rejection', () => {
    const script = `const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict');require.extensions['.ts']=(m,p)=>m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,p);const {createSetupCallbackServer}=require(${JSON.stringify(fileURLToPath(new URL('./setup-callback-server.ts', import.meta.url)))});const http=require('node:http');(async()=>{const server=createSetupCallbackServer({runtime:{completeSetupNotification:async()=>({status:'rejected',code:Promise.reject(Error('synthetic malformed async result'))})}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const status=await new Promise((r,j)=>{const req=http.request({host:'127.0.0.1',port:server.address().port,path:'/v1/setup/notify?capability=opaque',method:'POST',headers:{'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>r(res.statusCode));});req.on('error',j);req.end('{}');});assert.equal(status,503);await new Promise(r=>server.close(r));await new Promise(r=>setTimeout(r,5));process.stdout.write('native-observed');})().catch(()=>process.exitCode=1);`;
    const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '-e', script], { cwd: process.cwd(), encoding: 'utf8', timeout: 10000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('native-observed');
});
