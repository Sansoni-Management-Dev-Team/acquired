import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {Pool,type PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {drizzle} from 'drizzle-orm/node-postgres';
import {sql} from 'drizzle-orm';
import {AgentResearchStore} from './agent-research-store';
import {assertNativeResearchPersistence} from '@/lib/agent-research-context';
import {briefToMandate,emptyBrief} from '@/domain/acquisition';
import type {HybridCompanyContinuationReview} from '@/domain/hybrid-company-continuation';

// Only disposable, owned fixtures on the explicitly marked local database.
// No migration application, worker/provider calls, credential access or sends.
const enabled=process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode',options:'-c statement_timeout=3000 -c lock_timeout=1000'});
let org:string,user:string,mandate:string,thread:string,store:AgentResearchStore;
let sourceOperation:string,sourceRoot:string,uncertainOperation:string|undefined;
class RestrictedReadProbe extends AgentResearchStore{
 async rawResearchRead(id:string){return this.nativeTransaction(c=>c.query('SELECT id FROM research_jobs WHERE id=$1',[id]));}
}
const selection=[
 {candidateKey:'firmable:f1',domain:'saved.example.invalid',firmableId:'f1',sources:['firmable'],outcome:'saved'},
 {candidateKey:'firmable:f2',domain:'remaining.example.invalid',firmableId:'f2',sources:['firmable'],outcome:'not_started'},
 {candidateKey:'firmable:f3',domain:'interrupted.example.invalid',firmableId:'f3',sources:['firmable'],outcome:'interrupted'},
 {candidateKey:'firmable:f4',domain:'failed.example.invalid',firmableId:'f4',sources:['firmable'],outcome:'known_failed'},
 {candidateKey:'domain:web.example.invalid',domain:'web.example.invalid',firmableId:null,sources:['web'],outcome:'not_started'},
];
const web={domain:'web.example.invalid',name:'Synthetic saved web observation',website:'https://web.example.invalid',discovery:{url:'https://web.example.invalid',title:'Synthetic company',snippet:'Original owned source evidence'}};
const firms=selection.filter(item=>item.firmableId).map(item=>({id:item.firmableId,name:'Synthetic '+item.firmableId,website:'https://'+item.domain,fixtureOriginal:'source evidence remains on original root'}));
async function ownerWrite(work:(c:PoolClient)=>Promise<unknown>){const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT communications_lock_send_gate($1)',[org]);await work(c);await c.query('COMMIT');}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}}
async function scope(){const s=await store.researchSupervisionContext(thread),r=s.responsibility!;return{responsibilityId:r.id,responsibilityRevision:r.revision,mandateRevision:s.mandateRevision};}
async function review(id:string){const batch=(await store.listReviewBatches(thread)).find(value=>value.id===id);if(!batch)throw Error('Owned proposal review missing');return batch;}
async function approve(id:string){const batch=await review(id);return store.decideReviewBatch(thread,batch.id,batch.revision,batch.manifest,'approved');}
async function options(){return store.researchContinuationOptions(thread);}
async function oneOption():Promise<HybridCompanyContinuationReview>{const found=(await options()).find(item=>item.sourceRootId===sourceRoot);if(!found)throw Error('Owned original continuation option missing');return found;}
async function propose(companyContinuation:HybridCompanyContinuationReview){return store.proposeResearchPlan(thread,randomUUID(),{...await scope(),companyContinuation});}
async function sourceSnapshot(){return(await pool.query('SELECT status,config FROM research_jobs WHERE id=$1 AND organization_id=$2',[sourceRoot,org])).rows[0];}
async function mutateSourceName(){await ownerWrite(c=>c.query("UPDATE research_jobs SET config=jsonb_set(config,'{firmableSearchPages,0,records,1,name}','\"Changed owned source evidence\"'::jsonb) WHERE id=$1 AND organization_id=$2",[sourceRoot,org]));}
async function counts(){return(await pool.query("SELECT (SELECT count(*)::int FROM research_jobs WHERE organization_id=$1) roots,(SELECT count(*)::int FROM agent_operations WHERE organization_id=$1 AND name='research.provider') providers",[org])).rows[0];}
async function originalUnknownState(){return{operation:(await pool.query('SELECT id,state,input,result FROM agent_operations WHERE id=$1 AND organization_id=$2',[uncertainOperation,org])).rows[0],reservations:(await pool.query('SELECT account_id,amount::text,actual::text,state FROM agent_budget_reservations WHERE operation_id=$1 AND organization_id=$2 ORDER BY account_id',[uncertainOperation,org])).rows};}
async function partialOriginal(withUnknown=false){
 const p=await store.proposeResearchPlan(thread,randomUUID(),await scope());sourceOperation=p.id;await approve(p.reviewBatchId!);const launch=await store.persistApprovedResearchLaunch(thread,p.id);expect(launch.dispatchReady).toBe(true);sourceRoot=launch.jobId;
 if(withUnknown){const begun=await store.beginNativeResearchAttempt(thread,randomUUID(),{researchOperationId:sourceOperation,researchJobId:sourceRoot,provider:'page',requestDigest:'c'.repeat(64)});if(begun.kind!=='started')throw Error('Original owned provider reservation missing');uncertainOperation=begun.operationId;await store.finishNativeResearchAttempt(thread,begun.operationId,begun.fence,{actualCostMicroUsd:null,costBasis:'unknown',response:{status:502},reason:'request_outcome_unknown'},sourceOperation);}
 await ownerWrite(async c=>{const row=(await c.query('SELECT config FROM research_jobs WHERE id=$1 AND organization_id=$2 FOR UPDATE',[sourceRoot,org])).rows[0];const config={...row.config,researchRunId:sourceRoot,firmableSearchPages:{'0':{records:firms,totalCompany:4}},webSearchPages:{'0':{ok:true,rows:[web]}},hybridResult:{discoveryPolicy:row.config.companyDiscoveryPolicy,selection}};await c.query("UPDATE research_jobs SET status='partial',config=$3 WHERE id=$1 AND organization_id=$2",[sourceRoot,org,JSON.stringify(config)]);});
 await store.finishNativeResearchJob(thread,sourceOperation);
}

describe.runIf(enabled)('store: reviewed continuation of owned V4 never-started company profiles',()=>{
 beforeAll(async()=>{expect((await pool.query("SELECT current_database() name,shobj_description(oid,'pg_database') marker FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});if(!(await pool.query("SELECT to_regprocedure('public.agent_assert_company_continuation(uuid)') IS NOT NULL installed")).rows[0].installed)throw Error('Environment not ready: separately approved local migration0087 must already be installed; this suite never applies it.');});
 beforeEach(async()=>{
  vi.stubEnv('RESEARCH_PIPELINE_DESIGN','hybrid-firmable-v1');org=randomUUID();user=randomUUID();mandate=randomUUID();uncertainOperation=undefined;
  const brief=emptyBrief();for(const[key,value]of[['subsectors','Commercial refrigeration'],['geography','QLD']])Object.assign(brief.criteria.find(item=>item.key===key)!,{value,state:'specified',confirmed:true});
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);await c.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic owned continuation store fixture',$3,'{}',$4)",[mandate,org,JSON.stringify({...briefToMandate(brief),brief}),user]);await c.query('COMMIT');}finally{c.release();}
  store=new AgentResearchStore(pool,{organizationId:org,userId:user});thread=(await store.openThread(mandate)).id;const state=await store.executionState(thread);await store.controlResponsibility(thread,randomUUID(),{action:'start',expectedRevision:0,mandateRevision:state.mandateRevision});
  for(const unit of['calls','usd_micro'])for(const prefix of['organization','user:'+user,'mandate:'+mandate])await store.configureBudget({scopeKey:prefix+':'+unit,unit,windowStart:new Date(Date.now()-60000).toISOString(),windowEnd:new Date(Date.now()+3600000).toISOString(),cap:unit==='calls'?(prefix.startsWith('mandate:')?'100':'500'):'100000000',expectedRevision:0});
 });
 afterEach(async()=>{if(org&&user){const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");for(const table of['agent_research_phase_allocations','agent_research_phase_budgets','agent_budget_reservations','agent_budget_accounts','agent_review_batches','agent_authority_grants','agent_operations','agent_responsibilities','agent_runs','agent_events','agent_messages','agent_threads','research_jobs','mandates','member','audit_events','communication_send_gates'])await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);await c.query('DELETE FROM organization WHERE id=$1',[org]);await c.query('DELETE FROM "user" WHERE id=$1',[user]);await c.query('COMMIT');}finally{c.release();}}vi.unstubAllEnvs();});
 afterAll(async()=>pool.end());
 it('offers only explicit never-started saved identities and requires a fresh human review before any new root or physical attempt',async()=>{
  await partialOriginal();const before=await sourceSnapshot(),beforeCounts=await counts(),option=await oneOption();expect(option).toEqual({version:1,sourceRootId:sourceRoot,sourceDigest:expect.stringMatching(/^[a-f\d]{64}$/),candidateKeys:['firmable:f2','domain:web.example.invalid']});expect(Object.keys(option).sort()).toEqual(['candidateKeys','sourceDigest','sourceRootId','version']);
  const p=await propose(option),batch=await review(p.reviewBatchId!);expect(batch.state).toBe('pending');expect(batch.stale).toBe(false);expect(batch.operations[0].input.config.companyContinuation).toEqual(option);expect(batch.operations[0].input.config.requestId).not.toBe(sourceRoot);expect(await counts()).toEqual(beforeCounts);
  await expect(store.persistApprovedResearchLaunch(thread,p.id)).rejects.toThrow(/approved/i);expect(await sourceSnapshot()).toEqual(before);expect(await counts()).toEqual(beforeCounts);
 });
 it('launches a distinct approved root and reconstructs original company evidence only server-side',async()=>{
  await partialOriginal();const original=await sourceSnapshot(),option=await oneOption(),p=await propose(option);await approve(p.reviewBatchId!);const launch=await store.persistApprovedResearchLaunch(thread,p.id);expect(launch).toMatchObject({dispatchReady:true});expect(launch.jobId).not.toBe(sourceRoot);expect(await store.persistApprovedResearchLaunch(thread,p.id)).toEqual(launch);
  const materialized=await store.nativeCompanyContinuation(thread,p.id);expect(materialized).toMatchObject({version:1,sourceRootId:sourceRoot,sourceDigest:option.sourceDigest});expect(materialized!.candidates).toEqual([{candidateKey:'firmable:f2',domain:'remaining.example.invalid',sources:['firmable'],firmableRow:firms[1]},{candidateKey:'domain:web.example.invalid',domain:web.domain,sources:['web'],webRow:web}]);
  expect(await sourceSnapshot()).toEqual(original);expect(await counts()).toEqual({roots:2,providers:0});expect((await pool.query('SELECT config FROM research_jobs WHERE id=$1 AND organization_id=$2',[launch.jobId,org])).rows[0].config).toMatchObject({companyContinuation:option,companyOnly:true,findPeople:false,includeCompanyPeople:false,includePhones:false,nativeAgent:{operationId:p.id}});
 });
 it('rejects a changed original source digest at human approval without saving another root',async()=>{
  await partialOriginal();const p=await propose(await oneOption()),batch=await review(p.reviewBatchId!);await mutateSourceName();await expect(store.decideReviewBatch(thread,batch.id,batch.revision,batch.manifest,'approved')).rejects.toThrow(/source|changed|digest/i);expect(await counts()).toEqual({roots:1,providers:0});
 });
 it('rechecks the source digest after approval and again before dispatch or materialization',async()=>{
  await partialOriginal();const p=await propose(await oneOption());await approve(p.reviewBatchId!);await store.persistApprovedResearchLaunch(thread,p.id);await mutateSourceName();await expect(store.beginNativeResearchDispatch(thread,p.id)).rejects.toThrow(/source|changed|digest/i);await expect(store.nativeCompanyContinuation(thread,p.id)).rejects.toThrow(/source|changed|digest/i);expect(await counts()).toEqual({roots:2,providers:0});expect((await pool.query("SELECT count(*)::int n FROM agent_operations WHERE organization_id=$1 AND name='research.worker_dispatch'",[org])).rows[0].n).toBe(0);
 });
 it('blocks competing overlapping reviews while permitting only an untouched rejected proposal to release its claim',async()=>{
  await partialOriginal();const option=await oneOption(),first=await propose({...option,candidateKeys:['firmable:f2']});await expect(propose(option)).rejects.toThrow(/claim|already|candidate/i);expect(await counts()).toEqual({roots:1,providers:0});
  const batch=await review(first.reviewBatchId!);await store.decideReviewBatch(thread,batch.id,batch.revision,batch.manifest,'rejected');const replacement=await propose(option);expect(replacement.id).not.toBe(first.id);const batches=await store.listReviewBatches(thread),historical=batches.find(value=>value.id===first.reviewBatchId),current=batches.find(value=>value.id===replacement.reviewBatchId);expect(historical).toMatchObject({state:'rejected',stale:true});expect(current).toMatchObject({state:'pending',stale:false});expect(current!.operations[0].input.config.companyContinuation).toEqual(option);
 });
 it('preserves the original uncertain provider receipt and monetary holds across a separately approved continuation',async()=>{
  await partialOriginal(true);const before=await originalUnknownState();expect(before.operation.state).toBe('uncertain');expect(before.reservations).toHaveLength(6);expect(before.reservations.filter(row=>row.state==='uncertain').map(row=>row.amount)).toEqual(['1000000','1000000','1000000']);
  const option=await oneOption(),p=await propose(option);await approve(p.reviewBatchId!);await store.persistApprovedResearchLaunch(thread,p.id);expect(await originalUnknownState()).toEqual(before);expect((await store.listBudgetAccounts()).filter(account=>account.unit==='usd_micro').map(account=>account.reserved)).toEqual(['12000000','12000000','12000000']);
 });
 it('never offers or accepts a second-generation continuation source',async()=>{
  await partialOriginal();const option=await oneOption(),p=await propose(option);await approve(p.reviewBatchId!);const launch=await store.persistApprovedResearchLaunch(thread,p.id);await ownerWrite(c=>c.query("UPDATE research_jobs SET status='partial' WHERE id=$1 AND organization_id=$2",[launch.jobId,org]));await store.finishNativeResearchJob(thread,p.id);
  expect((await options()).some(item=>item.sourceRootId===launch.jobId)).toBe(false);await expect(propose({...option,sourceRootId:launch.jobId})).rejects.toThrow(/continuation|original|source/i);expect(await counts()).toEqual({roots:2,providers:0});
 });
 it('keeps direct research source SELECT denied under the ordinary agent role',async()=>{
  await partialOriginal();await expect(new RestrictedReadProbe(pool,{organizationId:org,userId:user}).rawResearchRead(sourceRoot)).rejects.toMatchObject({code:'42501'});
  expect((await oneOption()).candidateKeys).toEqual(['firmable:f2','domain:web.example.invalid']);
 });
 it('checks actual continuation persistence authority and restores the writer role and previous actor settings',async()=>{
  await partialOriginal();const p=await propose(await oneOption());await approve(p.reviewBatchId!);const launch=await store.persistApprovedResearchLaunch(thread,p.id),current=(await pool.query('SELECT config FROM research_jobs WHERE id=$1 AND organization_id=$2',[launch.jobId,org])).rows[0],original=await sourceSnapshot(),database=drizzle(pool);
  await database.transaction(async tx=>{
   await tx.execute(sql`SELECT set_config('app.acquire_org','previous-persistence-organization',true),set_config('app.acquire_user','previous-persistence-user',true)`);
   const before=await tx.execute(sql`SELECT current_setting('role',true) role,current_setting('app.acquire_org',true) organization_id,current_setting('app.acquire_user',true) user_id`);
   await assertNativeResearchPersistence(tx,{organizationId:org,mandateId:mandate,createdBy:user,config:current.config});
   const after=await tx.execute(sql`SELECT current_setting('role',true) role,current_setting('app.acquire_org',true) organization_id,current_setting('app.acquire_user',true) user_id`);
   expect(after.rows).toEqual(before.rows);
   expect((await tx.execute(sql`SELECT id FROM research_jobs WHERE id=${launch.jobId}::uuid AND organization_id=${org}`)).rows).toEqual([{id:launch.jobId}]);
  });
  expect(await sourceSnapshot()).toEqual(original);expect(await counts()).toEqual({roots:2,providers:0});
 });
 it('blocks a stale source digest inside the real persistence transaction before its ordinary source write',async()=>{
  await partialOriginal();const p=await propose(await oneOption());await approve(p.reviewBatchId!);const launch=await store.persistApprovedResearchLaunch(thread,p.id),current=(await pool.query('SELECT config FROM research_jobs WHERE id=$1 AND organization_id=$2',[launch.jobId,org])).rows[0],database=drizzle(pool);
  await mutateSourceName();
  await expect(database.transaction(async tx=>{
   await assertNativeResearchPersistence(tx,{organizationId:org,mandateId:mandate,createdBy:user,config:current.config});
   await tx.execute(sql`UPDATE research_jobs SET config=config||'{"persistenceProbe":true}'::jsonb WHERE id=${launch.jobId}::uuid AND organization_id=${org}`);
  })).rejects.toThrow(/source|changed|digest/i);
  expect((await pool.query("SELECT config ? 'persistenceProbe' attempted FROM research_jobs WHERE id=$1 AND organization_id=$2",[launch.jobId,org])).rows[0].attempted).toBe(false);expect(await counts()).toEqual({roots:2,providers:0});
 });
});
