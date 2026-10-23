import{resolve,dirname,sep}from'node:path';
import{existsSync}from'node:fs';
import{enableLocalFirmableDesign}from'./dev-config.mjs';
import{agentDatabaseConfig}from'./agent-mode-local-database.mjs';
const designs={D:'D',E:'E',F:'F','firmable-v1':'D','web-firmable-v1':'E','hybrid-firmable-v1':'F'};
/** Local research parity only. Messaging, auth, database and raw browser
 * credentials never come from the imported Firmable credential object. */
export function buildAgentModeResearchEnvironment(app,worker,credentials,{design='F',firmableMode='live'}={}){
 if(app.DATABASE_URL!==agentDatabaseConfig('container').url||app.LOCAL_DEVELOPMENT!=='true'||app.NODE_ENV!=='development'||!['http://acquire-agent.orb.local','http://localhost:3026'].includes(app.APP_URL)||app.RESEARCH_WORKER_URL!=='http://127.0.0.1:8787')throw Error('Explicit isolated research configuration required');
 if(!Object.hasOwn(designs,design))throw Error('Choose explicit local research design D, E or F');
 if(!['live','disabled'].includes(firmableMode))throw Error('Choose explicit local Firmable mode live or disabled');
 const clean=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!key.startsWith('FIRMABLE_')&&key!=='LOCAL_FIRMABLE_MODE')),config={app:clean(app),worker:clean(worker)};
 Object.assign(config.app,{ALLOW_REAL_PERSONAL_DATA:'true',TARGET_DATA_PROVIDER:'live',OUTREACH_DRAFTING_PROVIDER:'ai',FIRMABLE_TRANSPORT:'',FIRMABLE_SERVICE_URL:'',FIRMABLE_SERVICE_SECRET:'',FIRMABLE_BENCHMARK_COHORT:'',LOCAL_RESEARCH_BENCHMARK:''});
 if(firmableMode==='disabled'){
  if(!worker.SERVICE_SECRET)throw Error('Paused local Firmable transport requires its existing service authentication');
  const pipeline={D:'firmable-v1',E:'web-firmable-v1',F:'hybrid-firmable-v1'}[designs[design]];
  Object.assign(config.app,{LOCAL_FIRMABLE_MODE:'disabled',RESEARCH_ENABLED:'true',RESEARCH_PIPELINE_DESIGN:pipeline,FIRMABLE_TRANSPORT:'cloudflare-session',FIRMABLE_SERVICE_URL:'http://127.0.0.1:8787/firmable',FIRMABLE_SERVICE_SECRET:worker.SERVICE_SECRET});
  Object.assign(config.worker,{LOCAL_FIRMABLE_MODE:'disabled',LOCAL_DEVELOPMENT:'true',RESEARCH_PIPELINE_DESIGN:pipeline,FIRMABLE_SERVICE_SECRET:worker.SERVICE_SECRET});
  return config;
 }
 if(credentials===null||credentials===undefined){config.app.RESEARCH_ENABLED='false';return config;}
 // Existing local production-path composition copies only its explicit
 // credential allow-list to the durable account Worker, not to Next/app.
 return enableLocalFirmableDesign(config,credentials,8787,designs[design]);
}
export function agentModeFirmableCredentialsPath(worktreeRoot,localEnvPath,override){
 const local=resolve(worktreeRoot,'.local-data/firmable-D-credentials.json');
 const path=override?resolve(worktreeRoot,override):existsSync(local)?local:resolve(dirname(localEnvPath),'.local-data/firmable-D-credentials.json');
 if(!path.includes(sep+'.local-data'+sep)||!path.endsWith('.json'))throw Error('Choose an ignored local Firmable credentials JSON file');
 return path;
}
