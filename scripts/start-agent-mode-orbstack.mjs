import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { localWorkerConfig } from './dev-config.mjs';
import { agentDatabaseConfig } from './agent-mode-local-database.mjs';
import { buildAgentCommunicationsEnvironment } from './agent-mode-communications-env.mjs';
import { serializeAgentEnvironment } from './agent-mode-env-file.mjs';
import {agentModeLauncherServices} from './agent-mode-launcher-services.mjs';
import {assertAgentModeRestartIdle} from './agent-mode-restart-guard.mjs';
import { buildAgentWorkerEnvironment } from './agent-mode-worker-env.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, '.local-data/agent-mode-orbstack');
mkdirSync(directory, { recursive: true, mode: 0o700 });
// Reuse only local research credentials. Never import messaging, infrastructure,
// production database, or browser-session credentials into this preview.
const source = resolve(process.env.AGENT_MODE_LOCAL_ENV || resolve(root, '../project-acquire/.env.local'));
const original = existsSync(source) ? parseEnv(readFileSync(source, 'utf8')) : {};
const generatedTypes = resolve(directory, 'next-env.d.ts');
if (!existsSync(generatedTypes)) writeFileSync(generatedTypes, readFileSync(resolve(root, 'next-env.d.ts')));
const runtimePath = resolve(directory, 'runtime.env');
const previous = existsSync(runtimePath) ? parseEnv(readFileSync(runtimePath, 'utf8')) : {};
const keys = ['OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'OPENROUTER_BASE_URL', 'ABN_LOOKUP_GUID'];
const research = Object.fromEntries(keys.filter(key => original[key]).map(key => [key, original[key]]));
const origin = process.env.AGENT_MODE_ORIGIN || 'http://acquire-agent.orb.local';
if (!['http://acquire-agent.orb.local', 'http://localhost:3026'].includes(origin)) throw new Error('Choose the OrbStack address or localhost:3026.');
const serviceSecret = previous.RESEARCH_SERVICE_SECRET || randomBytes(32).toString('hex');
const baseRuntime = {
  ...research,
  NODE_ENV: 'development', LOCAL_DEVELOPMENT: 'true',
  APP_URL: origin, NEXT_PUBLIC_APP_URL: origin,
  AGENT_MODE_EXPLORATION_ENABLED: 'true', AGENT_DURABLE_STATE_ENABLED:'true', AGENT_GUIDANCE_ENABLED:'true',
  AGENT_LOCAL_SIMULATION_ENABLED: 'true',
  AGENT_NATIVE_EXECUTION_ENABLED: previous.AGENT_NATIVE_EXECUTION_ENABLED || 'false',
  AGENT_WORKER_SECRET: previous.AGENT_WORKER_SECRET || randomBytes(32).toString('hex'),
  DATABASE_DRIVER: 'postgres', DATABASE_URL: agentDatabaseConfig('container').url,
  DATABASE_SSL_CA: '', BETTER_AUTH_SECRET: previous.BETTER_AUTH_SECRET || randomBytes(48).toString('hex'),
  TARGET_DATA_PROVIDER: 'fixture', OUTREACH_DRAFTING_PROVIDER: 'fixture', AI_PROVIDER: 'openai', RESEARCH_AI_PROVIDER: 'openai', OPENAI_RESEARCH_MODEL: 'gpt-6-luna', OPENAI_RESEARCH_FALLBACK_MODEL: 'gpt-5.6-luna', OPENAI_MANDATE_MODEL: 'gpt-6-luna',
  RESEARCH_ENABLED: 'true', RESEARCH_WORKER_URL: 'http://127.0.0.1:8787', RESEARCH_SERVICE_SECRET: serviceSecret,
  APP_READINESS_SECRET: previous.APP_READINESS_SECRET || randomBytes(32).toString('hex'),
  CAMPAIGN_N8N_ENABLED: 'false', CAMPAIGN_LINKEDIN_ENABLED: 'false', CAMPAIGN_REPLY_MONITOR_MODE: 'off',
  COMMUNICATIONS_RUNTIME_ENABLED: 'false', COMMUNICATIONS_SERVICE_URL: '', COMMUNICATIONS_SERVICE_SECRET: '',
  UNIPILE_API_KEY: '', UNIPILE_DSN: '', UNIPILE_BASE_URL: '',
  WHATSAPP_SERVICE_URL: '', WHATSAPP_SERVICE_SECRET: '', LINKEDIN_SERVICE_URL: '', LINKEDIN_SERVICE_SECRET: '',
  CF_ACCOUNT_ID: '', CF_BROWSER_TOKEN: '', CLOUDFLARE_API_TOKEN: '',
  GOOGLE_GMAIL_CLIENT_ID: '', GOOGLE_GMAIL_CLIENT_SECRET: '',
  NEXT_TELEMETRY_DISABLED: '1',
};
// A saved explicit selection keeps ordinary restarts on their current profile.
const profilePath=resolve(directory,'communications-profile');
const chosen=process.env.AGENT_MODE_COMMUNICATIONS_PROFILE||(existsSync(profilePath)?readFileSync(profilePath,'utf8').trim():'mailbox');
if(!['mailbox','simulator','simulator25','simulator50','multichannel'].includes(chosen))throw Error('Choose mailbox, simulator, simulator25, simulator50 or multichannel communications profile');
const simulated=chosen!=='mailbox';
// Opt-in settings are private to THIS worktree. Ordinary research startup never
// imports messaging configuration from the main worktree. Connection-only mode
// retains zero sending capacity and cannot turn on the native executor.
const communicationsPath=resolve(directory,chosen==='multichannel'?'communications.simulator-multichannel.private.env':chosen==='simulator50'?'communications.simulator50.private.env':chosen==='simulator25'?'communications.simulator25.private.env':chosen==='simulator'?'communications.simulator.private.env':'communications.private.env');
if(simulated&&!existsSync(communicationsPath))throw Error('Prepare the dedicated simulator profile first');
const communications=buildAgentCommunicationsEnvironment(baseRuntime,existsSync(communicationsPath)?parseEnv(readFileSync(communicationsPath,'utf8')):{});
const workerOverrides=Object.fromEntries(['AGENT_NATIVE_EXECUTION_ENABLED','AGENT_WORKER_MANDATE_ID','AGENT_MODE_SIMULATOR_TEST_POLICY','AGENT_WORKER_SCOPE_MODE','AGENT_WORKER_RUNTIME_ID'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
const runtime=buildAgentWorkerEnvironment(communications.application,previous,workerOverrides,chosen);
const workerControls=Object.fromEntries(['AGENT_NATIVE_EXECUTION_ENABLED','AGENT_WORKER_MANDATE_ID','AGENT_WORKER_REQUIRE_MANDATE_SCOPE','AGENT_MODE_SIMULATOR_TEST_POLICY','AGENT_WORKER_SCOPE_MODE','AGENT_WORKER_RUNTIME_ID'].filter(key=>runtime[key]!==undefined).map(key=>[key,runtime[key]]));
writeFileSync(profilePath,chosen+'\n',{mode:0o600});
const worker = {
  ...research, SERVICE_SECRET: serviceSecret, RESEARCH_AI_PRIMARY_ROUTE: 'free', RESEARCH_AI_PROVIDER: 'openai', OPENAI_RESEARCH_MODEL: 'gpt-6-luna', OPENAI_RESEARCH_FALLBACK_MODEL: 'gpt-5.6-luna',
  // Use the existing reader-based search path; shared OpenSERP currently times out.
  LOCAL_CRAWL4AI_URL: 'http://127.0.0.1:18083',
};
function envFile(path, values) { writeFileSync(path, serializeAgentEnvironment(values), { mode: 0o600 }); }
envFile(runtimePath, runtime);
if(communications.enabled)envFile(resolve(directory,'communications-service.env'),{...communications.service,...workerControls,AGENT_NATIVE_EXECUTION_ENABLED:'false'});
envFile(resolve(directory, 'worker.env'), worker);
const base = JSON.parse(readFileSync(resolve(root, 'cloudflare/research/wrangler.jsonc'), 'utf8'));
writeFileSync(resolve(directory, 'wrangler.json'), JSON.stringify(localWorkerConfig(base, 'http://127.0.0.1:3000', '/workspace/cloudflare/research/index.ts', 'development'), null, 2));
console.log('Starting Agent mode on OrbStack with its isolated local database; no schema commands are run.');
const compose=['--context','orbstack','compose','-f',resolve(root,'ops/agent-mode/compose.local.yml'),...(simulated?['-f',resolve(root,chosen==='multichannel'?'ops/agent-mode/compose.multichannel.yml':chosen==='simulator50'?'ops/agent-mode/compose.simulator50.yml':chosen==='simulator25'?'ops/agent-mode/compose.simulator25.yml':'ops/agent-mode/compose.simulator.yml')]:[]),...(communications.enabled?['--profile','mailbox-setup']:[])];
if(communications.enabled&&!existsSync(resolve(root,'.local-data/communications/service-build/service.cjs')))throw Error('Build the communications service before connection setup');
const leaveWorkerStopped=process.argv.includes('--leave-worker-stopped');
if(leaveWorkerStopped){const workerState=spawnSync('docker',['--context','orbstack','inspect','project-acquire-agent-worker','--format','{{.State.Running}}'],{encoding:'utf8'});if(workerState.status!==0||workerState.stdout.trim()!=='false')throw Error('Confirm the exact native worker is stopped before using --leave-worker-stopped');if(runtime.AGENT_NATIVE_EXECUTION_ENABLED!=='false')throw Error('Stopped-worker setup requires native execution disabled');}
const restartApp=process.argv.includes('--restart-app');
const launchServices=agentModeLauncherServices({workerStopped:leaveWorkerStopped,restartApp,simulated,communications:communications.enabled});
if(launchServices.stopWorkerBeforeUp){
  const stop=spawnSync('docker',['--context','orbstack','stop','project-acquire-agent-worker'],{cwd:root,stdio:'inherit'});
  if(stop.status!==0)throw Error('Could not stop the exact native worker before app restart');
  const idle=spawnSync('docker',['--context','orbstack','exec','project-acquire-agent-mode','node','--input-type=module','-e',`
    import{Pool}from'pg';const pool=new Pool({connectionString:process.env.DATABASE_URL});try{
      const {rows:[identity]}=await pool.query("SELECT current_database() AS database,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
      const {rows:[ops]}=await pool.query("SELECT count(*)::int AS n FROM agent_operations WHERE state='running'");
      const {rows:[runs]}=await pool.query("SELECT count(*)::int AS n FROM agent_runs WHERE state='running' AND (lease_until IS NULL OR lease_until>clock_timestamp())");
      console.log(JSON.stringify({...identity,runningOperations:ops.n,runningRuns:runs.n}));
    }finally{await pool.end();}
  `],{cwd:root,encoding:'utf8',timeout:15000});
  if(idle.status!==0)throw Error('Could not verify restart idleness; native worker remains stopped.');
  let observation;try{observation=JSON.parse(idle.stdout);}catch{throw Error('Restart state unavailable; native worker remains stopped.');}
  assertAgentModeRestartIdle(observation);
}
const result = spawnSync('docker', [...compose, 'up', '-d', '--build',...launchServices.up], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
if(restartApp){
  const restart=spawnSync('docker',[...compose,'up','-d','--no-deps','--force-recreate','app'],{cwd:root,stdio:'inherit'});
  if(restart.status!==0)throw new Error('Agent preview app recreation failed');
}
// These processes share app's network namespace. A Next/app restart can leave
// otherwise-running dependants attached to the old namespace; always rebind
// them after the app/dependency update before asserting callback readiness.
const rebind = spawnSync('docker', [...compose, 'up', '-d', '--no-deps', '--force-recreate', ...launchServices.rebind], { cwd: root, stdio: 'inherit' });
if (rebind.status !== 0) process.exit(rebind.status || 1);
if(communications.enabled){
  const ready=spawnSync('docker',['--context','orbstack','exec','project-acquire-agent-mode','node','--input-type=module','-e',`
    for(let attempt=0;attempt<40;attempt++){
      try{
        const response=await fetch('http://127.0.0.1:5461/health',{signal:AbortSignal.timeout(1000)});
        if(response.ok){console.log(process.env.AGENT_MODE_COMMUNICATIONS_MODE==='simulator'?'Isolated mock communications service ready.':'Isolated communications service ready; outbound quotas remain zero.');process.exit(0);}
      }catch{}
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    console.error('Isolated communications service is not ready; inspect its private configuration and approved schema.');process.exit(1);
  `],{cwd:root,stdio:'inherit',timeout:65000});
  if(ready.status!==0)process.exit(ready.status||1);
}
// Probe with the application's actual secret, without printing it. Root has no
// handler: 404 proves authentication passed; anonymous access must still be401.
const preflight = spawnSync('docker', ['--context', 'orbstack', 'exec', 'project-acquire-agent-mode', 'node', '--input-type=module', '-e', `
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:8787/', {
        headers: { authorization: 'Bearer ' + process.env.RESEARCH_SERVICE_SECRET },
        signal: AbortSignal.timeout(2000),
      });
      await response.body?.cancel();
      if (response.status === 404) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) { console.error('Worker authentication preflight failed. Check the /config/.dev.vars mount.'); process.exit(1); }
  const anonymous = await fetch('http://127.0.0.1:8787/', { signal: AbortSignal.timeout(2000) });
  await anonymous.body?.cancel();
  if (anonymous.status !== 401) { console.error('Worker anonymous-access boundary failed.'); process.exit(1); }
  console.log('Worker authentication verified; anonymous requests remain denied.');
`], { cwd: root, stdio: 'inherit', timeout: 90000 });
if (preflight.status !== 0) process.exit(preflight.status || 1);
// The app owns a new network namespace. Recreate the worker only after every
// service/authentication check succeeds; starting its old container is unsafe.
if(launchServices.startWorkerAfterHealth){
  const start=spawnSync('docker',[...compose,'up','-d','--no-deps','--force-recreate','agent'],{cwd:root,stdio:'inherit'});
  if(start.status!==0)throw Error('Native worker could not rejoin the ready app namespace');
}
console.log(`Agent mode: ${origin}. Existing copied local email/password accounts can sign in; sessions were not copied.`);
