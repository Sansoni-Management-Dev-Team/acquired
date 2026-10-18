import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {drizzle} from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import {FirmableAccount} from '../../cloudflare/research/firmable/account';
import {assertNativeResearchPersistence} from '@/lib/agent-research-context';
import {firmableCompanyResearch} from '@/lib/firmable-company-research';
import {runFirmableCompanyPipeline} from '@/domain/firmable-company-pipeline';
import {briefToMandate} from '@/domain/acquisition';
const fixtureDb=vi.hoisted(()=>({value:undefined as unknown}));
vi.mock('@/db/client',()=>({requireDb:()=>fixtureDb.value}));
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {AgentResearchStore} from './agent-research-store';
import {emptyBrief} from '@/domain/acquisition';
import {agentOutboxFailurePool} from '@/test/agent-pg-fault';
import {createResearchSupervisor} from '@/lib/agent-research-supervisor';
import {createNativeResearchProviderFetch} from '@/lib/agent-research-provider-fetch';
import {runAgentEvent} from '@/lib/agent-event-worker';
const enabled=process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
const fixtureFirmableId='f'+BigInt('0x'+randomUUID().replaceAll('-','')).toString();
const org=randomUUID(),user=randomUUID(),mandate=randomUUID(),actor={organizationId:org,userId:user};
let store:AgentResearchStore,thread:string,launchedOperation:string,launchedJob:string;
function fixtureBrief(){const b=emptyBrief();for(const [key,value]of [['subsectors','Commercial refrigeration'],['geography','QLD']])Object.assign(b.criteria.find(c=>c.key===key)!,{value,state:'specified',confirmed:true});return b;}
describe.runIf(enabled)('reviewed native research supervision on isolated PostgreSQL',()=>{
 beforeAll(async()=>{
  expect((await pool.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
   await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);
   await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);
   await c.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic research test',$3,'{}',$4)",[mandate,org,JSON.stringify({...briefToMandate(fixtureBrief()),brief:fixtureBrief()}),user]);await c.query('COMMIT');
  }finally{c.release();}fixtureDb.value=drizzle(pool,{schema});store=new AgentResearchStore(pool,actor);thread=(await store.openThread(mandate)).id;
 });
 afterAll(async()=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");for(const table of ['agent_budget_reservations','agent_budget_accounts','agent_review_batches','agent_authority_grants','agent_operations','agent_conversations','agent_responsibilities','agent_runs','agent_events','agent_messages','agent_threads','research_jobs','contacts','targets','mandates','member','audit_events','communication_send_gates'])await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);await c.query("DELETE FROM firmable_companies f WHERE id=$1 AND name='Synthetic refrigeration' AND NOT EXISTS(SELECT 1 FROM targets t WHERE t.firmable_company_id=f.id)",[fixtureFirmableId]);await c.query('DELETE FROM organization WHERE id=$1',[org]);await c.query('DELETE FROM "user" WHERE id=$1',[user]);await c.query('COMMIT');}finally{c.release();}await pool.end();});
 async function start(){const state=await store.executionState(thread);await store.controlResponsibility(thread,randomUUID(),{action:'start',expectedRevision:state.responsibility?.revision??0,mandateRevision:state.mandateRevision});const s=await store.researchSupervisionContext(thread),r=s.responsibility!;return {responsibilityId:r.id,responsibilityRevision:r.revision,mandateRevision:s.mandateRevision};}
 it('persists one stable job handle, exact review, notice and outbox atomically across requests',async()=>{
  const scope=await start(),a=await store.proposeResearchPlan(thread,randomUUID(),scope),b=await store.proposeResearchPlan(thread,randomUUID(),scope);expect(b.id).toBe(a.id);
  const batch=(await store.listReviewBatches(thread)).find(b=>b.id===a.reviewBatchId)!;expect(batch.operations).toHaveLength(1);expect(batch.operations[0].name).toBe('research.start');expect(batch.operations[0].input.config.requestId).toMatch(/^[a-f0-9-]{36}$/);
  expect((await pool.query('SELECT count(*)::int AS n FROM research_jobs WHERE organization_id=$1',[org])).rows[0].n).toBe(0);
  await store.decideReviewBatch(thread,batch.id,batch.revision,batch.manifest,'approved');
  const approved=await store.approvedResearchPlan(thread,a.id);expect(approved).toMatchObject({dispatchReady:false,blockedReason:'budgeted_provider_adapter_required'});
  expect(approved.plan.config.requestId).toBe(batch.operations[0].input.config.requestId);
 });
 it('marks pending review stale and denies approval after mandate edits',async()=>{
  const scope=await start(),p=await store.proposeResearchPlan(thread,randomUUID(),scope),batch=(await store.listReviewBatches(thread)).find(b=>b.id===p.reviewBatchId)!;
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT communications_lock_send_gate($1)',[org]);await c.query("UPDATE mandates SET natural_language='Changed synthetic goal' WHERE id=$1",[mandate]);await c.query('COMMIT');}finally{c.release();}
  expect((await store.listReviewBatches(thread)).find(b=>b.id===batch.id)?.stale).toBe(true);
  await expect(store.decideReviewBatch(thread,batch.id,batch.revision,batch.manifest,'approved')).rejects.toThrow(/Mandate changed/);
 });
 it('rolls back plan, review, notice and child handle if notification persistence fails',async()=>{
  const scope=await start(),before=(await pool.query('SELECT count(*)::int AS n FROM agent_operations WHERE thread_id=$1',[thread])).rows[0].n;
  await expect(new AgentResearchStore(agentOutboxFailurePool(pool),actor).proposeResearchPlan(thread,randomUUID(),scope)).rejects.toThrow('Injected agent outbox failure');
  expect((await pool.query('SELECT count(*)::int AS n FROM agent_operations WHERE thread_id=$1',[thread])).rows[0].n).toBe(before);
 });
 it('pausing supervision invalidates current approval and rejects stale worker authority',async()=>{
  const scope=await start(),p=await store.proposeResearchPlan(thread,randomUUID(),scope),b=(await store.listReviewBatches(thread)).find(b=>b.id===p.reviewBatchId)!;
  await store.controlResponsibility(thread,randomUUID(),{action:'pause',expectedRevision:scope.responsibilityRevision,mandateRevision:scope.mandateRevision});
  expect((await store.listReviewBatches(thread)).find(current=>current.id===b.id)?.stale).toBe(true);
  await expect(store.decideReviewBatch(thread,b.id,b.revision,b.manifest,'approved')).rejects.toThrow(/supervision changed/);
  await expect(store.proposeResearchPlan(thread,randomUUID(),scope,{runId:randomUUID(),eventId:randomUUID(),leaseOwner:randomUUID(),fence:'1'})).rejects.toThrow(/authority expired/);
 });
 it('a fresh background worker handles supervision and creates a review without opening a page',async()=>{
  const scope=await start(),worker=new AgentResearchStore(pool,actor),handlers={'mandate.supervise':createResearchSupervisor(worker),'control.changed':async()=>({kind:'complete' as const}),'research.proposed':async()=>({kind:'complete' as const}),'review.approved':async()=>({kind:'complete' as const})};
  for(let n=0;n<30;n++){const result=await runAgentEvent({store:new AgentResearchStore(pool,actor),workerId:randomUUID(),handlers});if(result==='idle')break;}
  const batches=await new AgentResearchStore(pool,actor).listReviewBatches(thread);expect(batches.some(b=>b.operations.some((o:{input:{responsibilityRevision:number}})=>o.input.responsibilityRevision===scope.responsibilityRevision))).toBe(true);
 });
 it('rejects a rewritten native plan that changes its bounded policy while retaining the same context token',async()=>{
  const scope=await start(),p=await store.proposeResearchPlan(thread,randomUUID(),scope),batch=(await store.listReviewBatches(thread)).find(b=>b.id===p.reviewBatchId)!,op=batch.operations[0];
  const changed=await store.editProposedOperation(thread,op.id,op.revision,{...op.input,config:{...op.input.config,targetBusinesses:100}});
  const item={operationId:changed.id,revision:changed.revision,digest:changed.input_digest,contextRevision:changed.input.contextRevision};
  await expect(store.createReviewBatch(thread,randomUUID(),[item])).rejects.toThrow(/plan changed|policy/i);
 });
 it('atomically saves one approved stable research job and dispatch outbox without contacting providers',async()=>{
  const scope=await start(),p=await store.proposeResearchPlan(thread,randomUUID(),scope),b=(await store.listReviewBatches(thread)).find(b=>b.id===p.reviewBatchId)!;
  await store.decideReviewBatch(thread,b.id,b.revision,b.manifest,'approved');
  const first=await store.persistApprovedResearchLaunch(thread,p.id),again=await store.persistApprovedResearchLaunch(thread,p.id);expect(again).toEqual(first);launchedOperation=p.id;launchedJob=first.jobId;
  expect(first).toMatchObject({status:'queued',dispatchReady:false,blockedReason:'provider_budget_required'});
  const rows=(await pool.query('SELECT id,config,message FROM research_jobs WHERE organization_id=$1',[org])).rows;expect(rows).toHaveLength(1);expect(rows[0].config.nativeAgent).toMatchObject({version:1,operationId:p.id,providerAdmission:'required'});
  expect((await pool.query("SELECT count(*)::int AS n FROM agent_events WHERE thread_id=$1 AND event_key=$2",[thread,'research-dispatch:'+p.id])).rows[0].n).toBe(1);
  const input=b.operations[0].input,second=await store.proposeOperation(thread,randomUUID(),'research.start',{...input,config:{...input.config,requestId:randomUUID()}}),item={operationId:second.id,revision:second.revision,digest:second.input_digest,contextRevision:input.contextRevision},batch=await store.createReviewBatch(thread,randomUUID(),[item]);await store.decideReviewBatch(thread,batch.id,batch.revision,batch.manifest,'approved');
  await expect(store.persistApprovedResearchLaunch(thread,second.id)).rejects.toThrow(/already active/);
  const collision=await pool.connect();try{await collision.query('BEGIN');await collision.query("SET LOCAL session_replication_role='replica'");await collision.query("INSERT INTO research_jobs(id,organization_id,mandate_id,created_by,status,config) VALUES($1,$2,$3,$4,'cancelled','{}')",[second.input.config.requestId,org,mandate,user]);await collision.query('COMMIT');}finally{collision.release();}
  await expect(store.persistApprovedResearchLaunch(thread,second.id)).rejects.toThrow(/different work/);
  expect((await pool.query('SELECT config FROM research_jobs WHERE id=$1',[second.input.config.requestId])).rows[0].config).toEqual({});

 });
 it('reserves provider budgets before attempts, settles once, retains uncertainty and enforces physical-attempt caps',async()=>{
  const request={researchOperationId:launchedOperation,researchJobId:launchedJob,provider:'search',requestDigest:'a'.repeat(64)};
  await expect(store.beginNativeResearchAttempt(thread,randomUUID(),request)).rejects.toThrow(/Configure/);
  const windowStart=new Date();windowStart.setUTCHours(0,0,0,0);
  for(const unit of ['calls','usd_micro'])for(const scope of ['organization','user:'+user,'mandate:'+mandate])await store.configureBudget({scopeKey:scope+':'+unit,unit,windowStart:windowStart.toISOString(),windowEnd:new Date(windowStart.getTime()+86400000).toISOString(),cap:unit==='calls'?'20':'10000000',expectedRevision:0});
  expect(await store.persistApprovedResearchLaunch(thread,launchedOperation)).toMatchObject({dispatchReady:true});
  const key=randomUUID(),first=await store.beginNativeResearchAttempt(thread,key,request);if(first.kind!=='started')throw new Error('Expected a physical attempt reservation');
  await expect(store.beginNativeResearchAttempt(thread,key,request)).rejects.toThrow(/running|uncertain/);
  const receipt={response:{rows:[]},actualCostMicroUsd:'250',costBasis:'configured_rate_estimate'};
  await store.finishNativeResearchAttempt(thread,first.operationId,first.fence,receipt);await store.finishNativeResearchAttempt(thread,first.operationId,first.fence,receipt);
  expect(await store.beginNativeResearchAttempt(thread,key,request)).toMatchObject({kind:'cached',response:{rows:[]}});
  const unknownKey=randomUUID(),unknown=await store.beginNativeResearchAttempt(thread,unknownKey,request);if(unknown.kind!=='started')throw new Error('Expected a physical attempt reservation');
  await store.finishNativeResearchAttempt(thread,unknown.operationId,unknown.fence,{actualCostMicroUsd:null,costBasis:'unknown',reason:'request_outcome_unknown'});
  await expect(store.beginNativeResearchAttempt(thread,unknownKey,request)).rejects.toThrow(/uncertain/);
  expect((await store.listBudgetAccounts()).filter(a=>a.unit==='usd_micro').every(a=>a.spent==='250'&&a.reserved==='1000000')).toBe(true);
  for(let n=0;n<4;n++){const next=await store.beginNativeResearchAttempt(thread,randomUUID(),request);if(next.kind!=='started')throw new Error('Expected a physical attempt');await store.finishNativeResearchAttempt(thread,next.operationId,next.fence,{actualCostMicroUsd:'0',costBasis:'configured_rate_estimate',response:{rows:[]}});}
  await expect(store.beginNativeResearchAttempt(thread,randomUUID(),request)).rejects.toThrow(/attempt limit/);
 });
 it('a provider fetch observes committed budget reservations before HTTP and replays after a fresh adapter instance',async()=>{
  let requests=0;const prefix=randomUUID(),physical:typeof fetch=async()=>{requests++;const n=(await pool.query("SELECT count(*)::int AS n FROM agent_budget_reservations r JOIN agent_operations o ON o.id=r.operation_id WHERE o.thread_id=$1 AND o.name='research.provider' AND o.input->>'provider'='firmable' AND r.state='reserved'",[thread])).rows[0].n;expect(n).toBe(6);return Response.json({rows:[{name:'Synthetic business'}]});};
  const options={store,threadId:thread,researchOperationId:launchedOperation,researchJobId:launchedJob,provider:'firmable' as const,requestKeyPrefix:prefix,fetch:physical,estimateCost:()=>({actualCostMicroUsd:'0',costBasis:'configured_rate_estimate' as const})};
  expect(await (await createNativeResearchProviderFetch(options)('https://api.example.invalid/company')).json()).toEqual({rows:[{name:'Synthetic business'}]});
  expect(await (await createNativeResearchProviderFetch(options)('https://api.example.invalid/company')).json()).toEqual({rows:[{name:'Synthetic business'}]});expect(requests).toBe(1);
 });
 it('fences final native writes against a stale responsibility inside the actual persistence transaction',async()=>{
  const row=(await pool.query('SELECT * FROM research_jobs WHERE id=$1',[launchedJob])).rows[0],database=drizzle(pool,{schema}),before=(await pool.query('SELECT count(*)::int AS n FROM targets WHERE organization_id=$1',[org])).rows[0].n;
  await expect(database.transaction(async tx=>{await assertNativeResearchPersistence(tx,{organizationId:org,mandateId:mandate,createdBy:user,config:{...row.config,nativeAgent:{...row.config.nativeAgent,responsibilityRevision:row.config.nativeAgent.responsibilityRevision+1}}});await tx.insert(schema.targets).values({organizationId:org,mandateId:mandate,companyName:'Must not persist',firmographics:{}});})).rejects.toThrow(/context changed/);
  expect((await pool.query('SELECT count(*)::int AS n FROM targets WHERE organization_id=$1',[org])).rows[0].n).toBe(before);
 });
 it('runs the actual worker company pipeline through shared Firmable transport and persisted per-upstream budgets',async()=>{
  const intent=await store.beginNativeResearchDispatch(thread,launchedOperation);expect(intent.kind).toBe('started');await store.finishNativeResearchDispatch(thread,intent.operationId,true);expect((await store.beginNativeResearchDispatch(thread,launchedOperation)).kind).toBe('cached');
  const rootRow=async()=>{const r=(await pool.query('SELECT * FROM research_jobs WHERE id=$1',[launchedJob])).rows[0];return {id:r.id,organizationId:r.organization_id,mandateId:r.mandate_id,createdBy:r.created_by,status:r.status,config:r.config,seeds:r.seeds,discoveryStarted:r.discovery_started,revision:r.revision,pages:r.pages,modelCalls:r.model_calls,message:r.message,crawlId:r.crawl_id,createdAt:r.created_at,updatedAt:r.updated_at};};
  const state=new Map<string,unknown>(),env={APP_ORIGIN:'https://app.example.invalid',SERVICE_SECRET:'synthetic-worker-secret',FIRMABLE_CLIENT_COOKIE:'synthetic-cookie-long-enough',FIRMABLE_SESSION_ID:'sess_fixture',FIRMABLE_ORGANIZATION_ID:'org_fixture',FIRMABLE_CREDENTIAL_KEY:'a'.repeat(32)},storage={get:async(key:string)=>state.get(key),put:async(key:string,value:unknown)=>{state.set(key,value);}};let physicalCalls=0;
  const transport:typeof fetch=async(input,init)=>{const url=new URL(String(input));
   if(url.hostname==='app.example.invalid'){const p=JSON.parse(String(init?.body));if(p.action==='native-provider-begin')return Response.json(await store.beginNativeResearchAttempt(thread,p.key,{researchOperationId:launchedOperation,researchJobId:launchedJob,provider:'firmable',requestDigest:p.requestDigest}));await store.finishNativeResearchAttempt(thread,p.operationId,p.fence,p.outcome,launchedOperation);return Response.json({ok:true});}
   if(url.hostname==='service.example.invalid'){const headers=new Headers(init?.headers),result=await account.handle({path:url.pathname,method:init?.method??'GET',query:Object.fromEntries(url.searchParams),body:typeof init?.body==='string'?JSON.parse(init.body):undefined,nativeResearch:{jobId:headers.get('x-acquire-native-research-job')!,key:headers.get('x-acquire-native-research-key')!}});return Response.json(result.body,{status:result.status});}
   physicalCalls++;if(url.hostname==='clerk.firmable.com'){const claims={sid:env.FIRMABLE_SESSION_ID,o:{id:env.FIRMABLE_ORGANIZATION_ID},exp:Math.floor(Date.now()/1000)+300};return Response.json({jwt:`e30.${btoa(JSON.stringify(claims)).replaceAll('=','')}.signature`});}
   if(url.pathname.endsWith('/records/v2'))return Response.json({success:true,records:[{id:fixtureFirmableId,website:'https://synthetic-refrigeration.example.invalid',name:'Synthetic refrigeration'}],totalCompany:1,predictedFilters:{filters:{},operators:{},excluded:{}}});
   if(url.pathname.endsWith('/company/'+fixtureFirmableId))return Response.json({id:fixtureFirmableId,website:'https://synthetic-refrigeration.example.invalid',name:'Synthetic refrigeration',description:'Commercial refrigeration maintenance',states:['QLD'],industries:['Commercial refrigeration'],company_size:'15 - 50',revenue:'$4M - $10M'});
   throw new Error('Unexpected synthetic provider request');
  };const account=new FirmableAccount(storage as never,env,transport);
  vi.stubGlobal('fetch',transport);vi.stubEnv('FIRMABLE_TRANSPORT','cloudflare-session');vi.stubEnv('FIRMABLE_SERVICE_URL','https://service.example.invalid');vi.stubEnv('FIRMABLE_SERVICE_SECRET','synthetic-service-secret');
  try{const result=await runFirmableCompanyPipeline({checkpoint:async(_name,work)=>work(),now:()=>Date.now(),search:async(from,interpreted)=>firmableCompanyResearch(await rootRow(),{action:'d-search',from,interpreted}) as never,profile:async row=>firmableCompanyResearch(await rootRow(),{action:'d-company',row}) as never,finish:async result=>firmableCompanyResearch(await rootRow(),{action:'d-finish',result})},{deadline:Date.now()+60000,maxCompanies:20,pageSize:20,concurrency:2});expect(result).toMatchObject({saved:1,failed:0});
   expect(physicalCalls).toBe(3);expect((await rootRow()).status).toBe('complete');const finished=await store.finishNativeResearchJob(thread,launchedOperation);expect(finished).toMatchObject({companies:1,contacts:0,status:'complete'});
   expect((await pool.query("SELECT count(*)::int AS n FROM research_jobs WHERE organization_id=$1 AND config ? 'companyBackgroundResearch'",[org])).rows[0].n).toBe(0);
  }finally{vi.unstubAllGlobals();vi.unstubAllEnvs();}
 });
 it('reports only actual saved companies/contacts, tolerates stale child pointers, and ends at qualification review',async()=>{
  const target=randomUUID(),c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
   await c.query("INSERT INTO targets(id,organization_id,mandate_id,company_name,firmographics) VALUES($1,$2,$3,'Synthetic saved company','{}')",[target,org,mandate]);
   await c.query("INSERT INTO contacts(id,organization_id,mandate_id,target_id,display_name,provenance) VALUES($1,$2,$3,$4,'Synthetic saved person','{}')",[randomUUID(),org,mandate,target]);
   for(const targetId of [target,target,randomUUID(),'invalid-stale-id'])await c.query("INSERT INTO research_jobs(id,organization_id,mandate_id,created_by,status,config) VALUES($1,$2,$3,$4,'complete',$5)",[randomUUID(),org,mandate,user,JSON.stringify({parentJobId:launchedJob,targetId})]);
   await c.query("UPDATE research_jobs SET status='partial' WHERE id=$1",[launchedJob]);await c.query('COMMIT');
  }finally{c.release();}
  const result=await store.finishNativeResearchJob(thread,launchedOperation);expect(result).toMatchObject({status:'partial',companies:2,contacts:1});
  expect((await store.executionState(thread)).responsibility.milestone).toBe('qualification_review');
  expect((await store.messages(thread)).some(m=>m.content.text.includes('1 companies and 0 contacts'))).toBe(true);
 });
 it('legacy research proposals cannot become an executable native plan',async()=>{
  const op=await store.proposeOperation(thread,randomUUID(),'research.start',{contextRevision:'legacy',body:'Old generic proposal'}),item={operationId:op.id,revision:op.revision,digest:op.input_digest,contextRevision:'legacy'},batch=await store.createReviewBatch(thread,randomUUID(),[item]);await store.decideReviewBatch(thread,batch.id,1,[item],'approved');await expect(store.approvedResearchPlan(thread,op.id)).rejects.toThrow();
 });
});
