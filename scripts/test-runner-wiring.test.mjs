import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import config from '../vitest.config.mts';
const omitted=[
 'ops/agent-mode/setup-callback-gateway.test.mjs',
 'ops/agent-mode/simulator-transports.test.mjs',
 'scripts/agent-mode-communications-env.test.mjs',
 'scripts/agent-mode-env-file.test.mjs',
 'scripts/agent-mode-launcher-services.test.mjs',
 'scripts/agent-mode-restart-guard.test.mjs',
 'scripts/agent-mode-worker-env.test.mjs',
];
it('all existing Node-only suites are excluded from Vitest rather than executed by both runners',()=>{
 expect(config.test.exclude).toEqual(expect.arrayContaining(omitted));
});
it('the normal test command delegates Node test discovery instead of a drifting per-file list',()=>{
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 expect(pkg.scripts.test).toContain('test:node');
 expect(pkg.scripts['test:node']).toBe('node scripts/run-node-tests.mjs');
});

it('shares the same complete inventory with the Node command and keeps Vitest mjs suites enabled',async()=>{
 const {discoverNodeTestFiles}=await import('./test-runner-files.mjs');
 const {nodeTestArguments}=await import('./run-node-tests.mjs');
 const files=discoverNodeTestFiles();
 expect(files).toEqual(expect.arrayContaining([...omitted,'ops/agent-mode/native-worker.test.mjs','scripts/app-deploy-host.test.mjs']));
 expect(nodeTestArguments()).toEqual(['--test',...files]);
 expect(config.test.exclude).toEqual(expect.arrayContaining(files));
 expect(files).not.toContain('scripts/dev-config.test.mjs');expect(config.test.exclude).not.toContain('scripts/dev-config.test.mjs');
});
it('classifies test syntax without importing suites or matching comments, quoted code or unrelated imports',async()=>{
 const {testRunner}=await import('./test-runner-files.mjs');
 expect(testRunner('// import test from "node:test";\nimport {it} from "vitest";')).toBe('vitest');
 expect(testRunner('const example = `import test from "node:test"`;')).toBe('vitest');
 expect(testRunner('import {test} from "node:test"; process.exit(91);')).toBe('node');
 expect(testRunner('const {test}=require("node:test");')).toBe('node');
 expect(testRunner('const {test}=await import("node:test");')).toBe('node');
 expect(()=>testRunner('import test from "node:test"; import {it} from "vitest";','mixed.test.mjs')).toThrow('mixes node:test and Vitest: mixed.test.mjs');
});
it('automatically discovers nested normal test files while ignoring dependencies, private artifacts and symlinks',async()=>{
 const {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {discoverNodeTestFiles}=await import('./test-runner-files.mjs');
 const {nodeTestArguments}=await import('./run-node-tests.mjs');
 const root=mkdtempSync(join(tmpdir(),'acquire-test-runners-'));
 try{
  const fixtures={
   'ops/nested/new.test.mjs':'import test from "node:test"; throw Error("must never execute during discovery");',
   'scripts/common.spec.cjs':'const {test}=require("node:test");',
   'src/stays.test.ts':'import {it} from "vitest";',
   'scripts/manual.selftest.mjs':'import test from "node:test";',
   '.local-data/private.test.mjs':'import test from "node:test";',
   'node_modules/vendor/leak.test.mjs':'import test from "node:test";',
  };
  for(const [name,source] of Object.entries(fixtures)){const file=join(root,name);mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,source);}
  symlinkSync(join(root,'ops'),join(root,'linked-ops'),'dir');
  expect(discoverNodeTestFiles(root)).toEqual(['ops/nested/new.test.mjs','scripts/common.spec.cjs']);
  expect(nodeTestArguments({root,args:['--test-name-pattern=bounded case']})).toEqual(['--test','--test-name-pattern=bounded case','ops/nested/new.test.mjs','scripts/common.spec.cjs']);
  rmSync(join(root,'ops'),{recursive:true});rmSync(join(root,'scripts'),{recursive:true});
  expect(()=>nodeTestArguments({root})).toThrow('No node:test suites discovered');
 }finally{rmSync(root,{recursive:true,force:true});}
});
