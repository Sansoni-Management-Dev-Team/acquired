import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {Pool, type PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {agentRecordDigest} from './agent-store';
import {emptyBrief, briefToMandate} from '@/domain/acquisition';
import {buildAgentResearchPlan} from '@/lib/agent-research-plan';

// Rollback-only fixtures; no migration application, worker, provider or send I/O.
const enabled = process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION === 'true';
const pool = new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode',options:'-c statement_timeout=3000 -c lock_timeout=1000'});
let client: PoolClient;
let org:string,user:string,mandate:string,thread:string,responsibility:string,operation:string,job:string;

describe.runIf(enabled)('0086 reviewed company-only weighted phase funding',()=>{
 beforeAll(async()=>{
  expect((await pool.query("SELECT current_database() name,shobj_description(oid,'pg_database') marker FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
 });
 beforeEach(async()=>{client=await pool.connect();await client.query('BEGIN');org=randomUUID();user=randomUUID();mandate=randomUUID();thread=randomUUID();responsibility=randomUUID();operation=randomUUID();job=randomUUID();});
 afterEach(async()=>{await client.query('ROLLBACK');client.release();});
 afterAll(async()=>pool.end());
 async function fixture(version:3|4=4,change?:(plan:ReturnType<typeof buildAgentResearchPlan>)=>void,callCap=500){
  const brief=emptyBrief();for(const[key,value]of[['subsectors','Commercial refrigeration'],['geography','QLD']])Object.assign(brief.criteria.find(c=>c.key===key)!,{value,state:'specified',confirmed:true});
  await client.query("SET LOCAL session_replication_role='replica'");
  await client.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);
  await client.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);
  await client.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);
  await client.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic company-only funding fixture',$3,'{}',$4)",[mandate,org,JSON.stringify({...briefToMandate(brief),brief}),user]);
  const revision=(await client.query('SELECT xmin::text revision FROM mandates WHERE id=$1',[mandate])).rows[0].revision;
  await client.query('INSERT INTO agent_threads(id,organization_id,mandate_id,owner_user_id) VALUES($1,$2,$3,$4)',[thread,org,mandate,user]);
  await client.query("INSERT INTO agent_responsibilities(id,thread_id,organization_id,mandate_id,owner_user_id,state,mandate_revision) VALUES($1,$2,$3,$4,$5,'ready',$6)",[responsibility,thread,org,mandate,user,revision]);
  const plan=buildAgentResearchPlan({productionPipeline:'hybrid-firmable-v1',discoveryPolicyVersion:version,companyIdentityPolicyVersion:1,researchJobId:job,responsibilityId:responsibility,responsibilityRevision:1,mandateRevision:revision,brief});
  change?.(plan);
  const digest=agentRecordDigest({name:'research.start',input:plan});
  await client.query("INSERT INTO agent_operations(id,thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,state) VALUES($1::uuid,$2,$3,$4,$5,$1::text,'research.start',$6,$7,'running')",[operation,thread,org,mandate,user,JSON.stringify(plan),digest]);
  const manifest=[{operationId:operation,revision:1,digest,contextRevision:plan.contextRevision}];
  await client.query("INSERT INTO agent_review_batches(thread_id,organization_id,mandate_id,owner_user_id,request_key,manifest,manifest_digest,state,decided_by,decided_at) VALUES($1,$2,$3,$4,$5,$6,$7,'approved',$4,clock_timestamp())",[thread,org,mandate,user,randomUUID(),JSON.stringify(manifest),agentRecordDigest(manifest)]);
  for(const unit of ['calls','usd_micro'])for(const scope of ['organization','user:'+user,'mandate:'+mandate])await client.query("INSERT INTO agent_budget_accounts(organization_id,scope_key,unit,cap,window_start,window_end,approved_by) VALUES($1,$2,$3,$4,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',$5)",[org,scope+':'+unit,unit,unit==='calls'?String(Math.min(callCap,scope.startsWith('mandate:')?100:500)):'100000000',user]);
  await client.query("SET LOCAL session_replication_role='origin'");
  await client.query('SET LOCAL ROLE acquire_agent_user');
  await client.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[org,user]);
  await client.query('SELECT public.agent_lock_send_gate()');
  await client.query('SELECT agent_lock_member()');
  await client.query('SELECT public.agent_create_research_job($1::uuid)',[operation]);
  return plan;
 }
 async function value(sql:string,args:unknown[]=[]){return(await client.query(sql,args)).rows[0].value;}
 async function prepare(){return value('SELECT public.agent_prepare_hybrid_native_research($1::uuid) value',[operation]);}
 async function fund(){return value('SELECT public.agent_reserve_research_phase($1::uuid) value',[operation]);}
 async function attempt(provider:'firmable'|'search'|'page'|'ai',requestClass:string|null='company_profile'){
  const id=randomUUID(),input={researchOperationId:operation,researchJobId:job,provider,...(provider==='firmable'&&requestClass!==null?{requestClass}:{}),requestDigest:'a'.repeat(64)};
  await client.query("INSERT INTO agent_operations(id,thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,state) VALUES($1::uuid,$2,$3,$4,$5,$1::text,'research.provider',$6,$7,'running')",[id,thread,org,mandate,user,JSON.stringify(input),agentRecordDigest({name:'research.provider',input})]);
  return id;
 }
 async function transfer(id:string){return value('SELECT public.agent_transfer_research_phase_attempt($1::uuid,$2::uuid) value',[operation,id]);}
 async function failure(work:()=>Promise<unknown>){await client.query('SAVEPOINT expected_error');try{await expect(work()).rejects.toThrow();}finally{await client.query('ROLLBACK TO SAVEPOINT expected_error');}}
 it('funds V4 under normal 500/100-call caps: USD 11 escrow, no upfront call holds, fifteen-minute deadline',async()=>{
  await fixture();expect(await prepare()).toMatchObject({dispatchReady:true});
  const result=await fund();expect(result).toMatchObject({ready:true,calls:'24035',usdMicro:'11000000'});
  const deadline=new Date(result.deadline).getTime()-Date.now();expect(deadline).toBeGreaterThan(14*60000);expect(deadline).toBeLessThanOrEqual(15*60000);
  const allocations=await client.query('SELECT count(*)::int n FROM agent_research_phase_allocations WHERE operation_id=$1',[operation]);expect(allocations.rows[0].n).toBe(6);
  const held=(await client.query('SELECT a.unit,x.initial_amount::text,x.remaining_amount::text FROM agent_research_phase_allocations x JOIN agent_budget_accounts a ON a.id=x.account_id WHERE x.operation_id=$1',[operation])).rows;
  expect(held.filter(row=>row.unit==='calls').every(row=>row.initial_amount==='0'&&row.remaining_amount==='0')).toBe(true);
  const balances=(await client.query('SELECT unit,reserved::text FROM agent_budget_accounts WHERE organization_id=$1',[org])).rows;
  expect(balances.filter(row=>row.unit==='calls').every(row=>row.reserved==='0')).toBe(true);
  expect(await fund()).toEqual(result);
 });
 it('transfers zero dollars for Firmable, charges one call, and replays the exact six reservations without a second transfer',async()=>{
  await fixture();await prepare();await fund();const id=await attempt('firmable');
  const reservations=await transfer(id);expect(reservations).toHaveLength(6);expect(reservations.map((r:{amount:string})=>r.amount).sort()).toEqual(['0','0','0','1','1','1']);
  expect(await transfer(id)).toEqual({replay:true});
  const accounts=await client.query('SELECT unit,reserved::text FROM agent_budget_accounts WHERE organization_id=$1',[org]);expect(accounts.rows.every(row=>row.reserved===(row.unit==='calls'?'1':'11000000'))).toBe(true);
 });
 it('keeps unknown zero-dollar receipts uncertain, settles calls, and preserves the reserved search/page money',async()=>{
  await fixture();await prepare();await fund();const id=await attempt('firmable');await transfer(id);
  const rows=(await client.query('SELECT r.account_id,a.unit FROM agent_budget_reservations r JOIN agent_budget_accounts a ON a.id=r.account_id WHERE r.operation_id=$1',[id])).rows;
  await client.query('SELECT public.agent_settle_budget($1::uuid,$2::jsonb)',[id,JSON.stringify(rows.map(row=>({accountId:row.account_id,actual:row.unit==='calls'?'1':null})))]);
  const results=(await client.query('SELECT a.unit,r.amount::text,r.actual::text,r.state FROM agent_budget_reservations r JOIN agent_budget_accounts a ON a.id=r.account_id WHERE r.operation_id=$1',[id])).rows;
  expect(results.filter(row=>row.unit==='usd_micro').every(row=>row.amount==='0'&&row.actual===null&&row.state==='uncertain')).toBe(true);
  expect(results.filter(row=>row.unit==='calls').every(row=>row.actual==='1'&&row.state==='settled')).toBe(true);
  await failure(()=>transfer(id));
  const next=await attempt('search');expect((await transfer(next)).map((row:{amount:string})=>row.amount).sort()).toEqual(['1','1','1','1000000','1000000','1000000']);
 });
 it('retains legacy V3 seventy-one-dollar phase funding and ten-minute deadline',async()=>{
  await fixture(3);expect(await prepare()).toMatchObject({dispatchReady:true});const result=await fund();expect(result).toMatchObject({ready:true,calls:'71',usdMicro:'71000000'});
  const remaining=new Date(result.deadline).getTime()-Date.now();expect(remaining).toBeGreaterThan(9*60000);expect(remaining).toBeLessThanOrEqual(10*60000);
  const reservations=await transfer(await attempt('firmable'));expect(reservations.map((r:{amount:string})=>r.amount).sort()).toEqual(['1','1','1','1000000','1000000','1000000']);
 });
 it.each(['includePhones','includeCompanyPeople','findPeople'] as const)('rejects V4 %s even with matching approved review evidence',async flag=>{
  await fixture(4,plan=>{(plan.config as unknown as Record<string,unknown>)[flag]=true;});await failure(prepare);
 });
 it('rejects arbitrary zero-dollar pricing for search',async()=>{
  await fixture(4,plan=>{if(plan.providerPolicy.version===2)(plan.providerPolicy.requestCeilingsMicroUsd as Record<string,string>).search='0';});await failure(prepare);
 });
 it.each([null,'people_search','person_profile','phone_reveal','unsupported'])('rejects zero-priced Firmable request class %s without reserving calls or money',async requestClass=>{
  await fixture();await prepare();await fund();const id=await attempt('firmable',requestClass);await failure(()=>transfer(id));
  expect((await client.query('SELECT count(*)::int n FROM agent_budget_reservations WHERE operation_id=$1',[id])).rows[0].n).toBe(0);
  const held=(await client.query('SELECT unit,reserved::text FROM agent_budget_accounts WHERE organization_id=$1',[org])).rows;
  expect(held.every(row=>row.reserved===(row.unit==='calls'?'0':'11000000'))).toBe(true);
 });
 it('stops at current per-request call capacity without replaying or releasing an uncertain original attempt',async()=>{
  await fixture(4,undefined,1);await prepare();await fund();const first=await attempt('firmable');await transfer(first);
  expect(await transfer(first)).toEqual({replay:true});
  const second=await attempt('firmable');await failure(()=>transfer(second));
  expect((await client.query('SELECT count(*)::int n FROM agent_budget_reservations WHERE operation_id=$1',[second])).rows[0].n).toBe(0);
  expect((await client.query('SELECT count(*)::int n FROM agent_budget_reservations WHERE operation_id=$1',[first])).rows[0].n).toBe(6);
  const balances=(await client.query('SELECT unit,reserved::text FROM agent_budget_accounts WHERE organization_id=$1',[org])).rows;
  expect(balances.filter(row=>row.unit==='calls').every(row=>row.reserved==='1')).toBe(true);
  // Exhausting a future-call budget must not invalidate authority to publish an
  // already returned profile or receive its original receipt.
  expect(await value('SELECT public.agent_research_phase_budget_status($1::uuid) value',[operation])).toMatchObject({ready:true});
 });
 it('releases only unused phase escrow on cancellation and cannot replay a cancelled zero-dollar attempt',async()=>{
  await fixture();await prepare();await fund();const id=await attempt('firmable');await transfer(id);
  await client.query("UPDATE agent_responsibilities SET state='paused',revision=revision+1 WHERE id=$1",[responsibility]);
  const accounts=(await client.query('SELECT unit,reserved::text FROM agent_budget_accounts WHERE organization_id=$1',[org])).rows;
  expect(accounts.filter(row=>row.unit==='calls').every(row=>row.reserved==='1')).toBe(true);
  expect(accounts.filter(row=>row.unit==='usd_micro').every(row=>row.reserved==='0')).toBe(true);
  expect((await client.query('SELECT count(*)::int n FROM agent_budget_reservations WHERE operation_id=$1',[id])).rows[0].n).toBe(6);
  await failure(()=>transfer(id));
 });
 it('rejects text-valued flags rather than accepting them as an exact company-only plan',async()=>{
  await fixture(4,plan=>{(plan.config as unknown as Record<string,unknown>).includePhones='false';});await failure(prepare);
 });
 it('keeps the generic reservation API positive-only and refuses disallowed AI attempts',async()=>{
  await fixture();await prepare();await fund();const id=await attempt('ai');await failure(()=>transfer(id));
  const account=(await client.query("SELECT id FROM agent_budget_accounts WHERE organization_id=$1 AND scope_key='organization:usd_micro'",[org])).rows[0].id;
  await failure(()=>client.query('SELECT public.agent_reserve_budget($1::uuid,$2::jsonb)',[operation,JSON.stringify([{accountId:account,amount:'0'}])]));
 });
});
