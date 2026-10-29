// Test an already-running shared runtime. Never rebuild, switch providers, copy
// credentials or restart the Acquire bridge as a side effect of running a test.
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url)),args=process.argv.slice(2);
for(let i=0;i<args.length;i+=2)if(!['--mandate','--env','--report'].includes(args[i])||!args[i+1])throw Error('Use --mandate, --env or --report with a value');
const option=(key,fallback)=>args.includes(key)?resolve(args[args.indexOf(key)+1]):resolve(root,fallback);
process.env.RESEARCH_TEST_ENV=option('--env','.local/mirror/runtime-test.env');
process.env.RESEARCH_TEST_WORKER_ORIGIN||='http://127.0.0.1:18797';
process.env.RESEARCH_TEST_CALLBACK_ORIGIN||='http://127.0.0.1:18798';
process.env.RESEARCH_TEST_REPORT=option('--report','.local/mirror/parity-smoke-report.json');
process.argv=[process.argv[0],process.argv[1],option('--mandate','test/mandates/aged-care-software.json')];
await import('./deploy/smoke.mjs');
