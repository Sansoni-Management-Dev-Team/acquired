import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {DBOS} from '@dbos-inc/dbos-sdk';
import worker, {AcquireResearch,FirmableRefresh,ProviderCoordinator} from '../../../cloudflare/research/index.ts';
import {config} from './config.mjs';
import {workflowBinding,workflowStep} from './runtime.mjs';
import {coordinatorStorage,memoryCache} from './storage.mjs';
import {createTavily,tavilySearchResponse,providerFailureResponse} from './tavily.mjs';

const env = config(process.env);
const pool = new pg.Pool({connectionString:env.databaseUrl,max:4,connectionTimeoutMillis:5000,statement_timeout:10000});
// One process is intentional for the initial proof. A second instance refuses startup;
// the existing FirmableAccount implementation serializes requests inside this process.
const owner = new pg.Client({connectionString:env.databaseUrl,connectionTimeoutMillis:5000,application_name:'acquire-research-owner',keepAlive:true,keepAliveInitialDelayMillis:1000});
await owner.connect();
const identity = await owner.query("SELECT current_database() AS database, marker FROM research_service.identity WHERE singleton=true");
if (identity.rows[0]?.database !== env.databaseName || identity.rows[0]?.marker !== env.databaseMarker) throw new Error('Research database identity mismatch');
if (!(await owner.query('SELECT pg_try_advisory_lock(817324019) AS owned')).rows[0].owned) throw new Error('Research service is already running');
owner.on('error',()=>process.exit(1));

const coordinators = new Map();
env.PROVIDER_COORDINATOR = {
  idFromName:name=>name,
  get(name) {
    if (!['account-wide','firmable-account'].includes(name)) throw new Error('Unknown provider coordinator');
    if (!coordinators.has(name)) coordinators.set(name,new ProviderCoordinator({storage:coordinatorStorage(pool,name)},env));
    return coordinators.get(name);
  },
  getByName(name) { return this.get(name); },
};
globalThis.caches = {default:memoryCache()};
const step = workflowStep(DBOS);
const research = DBOS.registerWorkflow(payload=>new AcquireResearch({},env).run({payload},step),{name:'AcquireResearch'});
const firmable = DBOS.registerWorkflow(payload=>new FirmableRefresh({},env).run({payload},step),{name:'FirmableRefresh'});
env.RESEARCH = workflowBinding(DBOS,'research',research,'research');
env.FIRMABLE = workflowBinding(DBOS,'firmable',firmable,'research');
DBOS.setConfig({name:'acquire-research',applicationVersion:readFileSync(new URL('./revision',import.meta.url),'utf8').trim(),executorID:'single-research-worker',systemDatabaseUrl:env.databaseUrl,systemDatabasePoolSize:5,runMigrations:false});
await DBOS.launch();
await DBOS.registerQueue('research',{globalConcurrency:4,workerConcurrency:4});

let stopping = false;
const handle = async (req,res,readerOnly=false)=>{
  try {
    if (req.url === '/health/live') { res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');return; }
    if (req.url === '/health/ready') {
      await pool.query('SELECT 1');
      res.writeHead(stopping?503:200,{'Content-Type':'application/json'});res.end(JSON.stringify({ready:!stopping}));return;
    }
    if (stopping) {res.writeHead(503);res.end();return;}
    const chunks=[];let size=0;
    for await (const chunk of req) {
      size+=chunk.length;
      if (size>64*1024) {res.writeHead(413);res.end();return;}
      chunks.push(chunk);
    }
    const body=Buffer.concat(chunks);
    const request=new Request(new URL(req.url,'http://127.0.0.1:8787'),{method:req.method,headers:req.headers,...(body.length?{body}:{}),signal:AbortSignal.timeout(150000)});
    let response;
    if(readerOnly){
      if(req.url!=='/crawl'||req.method!=='POST')response=Response.json({error:'Not found'},{status:404});
      else{
        try{
          const payload=await request.json();
          const provider=createTavily({apiKey:env.TAVILY_API_KEY,onEvent:event=>console.info('research-provider',JSON.stringify({...event,jobId:req.headers['x-research-job-id']}))});
          response=Response.json(await provider.read(payload.url));
        }catch(error){response=providerFailureResponse(error)}
      }
    }else if(req.url==='/search'&&env.RESEARCH_SEARCH_PROVIDER==='tavily')response=await tavilySearchResponse(request,env,env.PROVIDER_COORDINATOR.getByName('account-wide'));
    else response=await worker.fetch(request,env);
    res.writeHead(response.status,Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch(error) {
    console.error(JSON.stringify({event:'request_failed',type:error.name}));
    res.writeHead([404,409].includes(error.status)?error.status:503,{'Content-Type':'application/json'});
    res.end(JSON.stringify({error:error.status===409?'Workflow input conflict':error.status===404?'Workflow not found':'Research service unavailable'}));
  }
};
const server=createServer((req,res)=>handle(req,res));
const reader=env.RESEARCH_READER_PROVIDER==='tavily'?createServer((req,res)=>handle(req,res,true)):undefined;
reader?.listen(18083,'127.0.0.1');
server.requestTimeout=150000;
server.listen(8787,'0.0.0.0');
let maintenance;
const timer=setInterval(()=>{
  if (!stopping&&!maintenance) maintenance=worker.scheduled({},env).catch(error=>console.error(JSON.stringify({event:'maintenance_failed',type:error.name}))).finally(()=>{maintenance=undefined});
},60000);
async function stop(){
  if(stopping)return;stopping=true;clearInterval(timer);
  server.close();reader?.close();
  await DBOS.shutdown({workflowCompletionTimeoutMS:10000});
  await pool.end();await owner.end();
}
process.once('SIGTERM',()=>stop().then(()=>process.exit(0)));
process.once('SIGINT',()=>stop().then(()=>process.exit(0)));
console.info(JSON.stringify({event:'ready',port:8787,mode:env.deployment+'-single-worker'}));
