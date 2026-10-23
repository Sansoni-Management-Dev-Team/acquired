import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {Pool,type PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {AgentInvitationStore} from './agent-invitation-store';
import {createAgentBusinessTimeContext} from '@/lib/agent-business-time';
import {agentBusinessTimePool} from '@/lib/agent-business-time-pool';

// Explicit marked-local PostgreSQL gate. Only fresh synthetic actors and their
// dedicated clock/runtime fixture rows are touched; no schema changes, external
// calls or worker processes.
const enabled=process.env.RUN_SIM28_LOCAL_ACCEPTANCE==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode',max:1,connectionTimeoutMillis:3000});
const fixtures=[2030,2040,2026].map(year=>({organizationId:randomUUID(),userId:randomUUID(),mandateId:randomUUID(),runId:'sim28-clock-'+randomUUID(),runtimeId:'sim28-runtime-'+randomUUID(),stamp:`${year}-01-07T00:00:00.000Z`,threadId:''}));
let attested=false;
// Inject only the fixture's runtime immediately after its own transaction starts.
// No global registered worker identity or channel acceleration is enabled.
function runtimePool(runtimeId:string):Pick<Pool,'connect'>{return{async connect(){const client=await pool.connect();return new Proxy(client,{get(target,key){if(key==='query')return async(sql:string,values?:unknown[])=>{const result=await target.query(sql,values);if(sql==='BEGIN')await target.query("SELECT set_config('app.acquire_runtime_id',$1,true)",[runtimeId]);return result;};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}}) as PoolClient;}};}
class ClockStore extends AgentInvitationStore{
 inspect(){return this.transaction(async c=>(await c.query("SELECT public.local_simulator_business_now() business_at,clock_timestamp() wall_at,pg_backend_pid() pid,current_user role,current_setting('app.acquire_org',true) org,current_setting('app.acquire_user',true) owner,current_setting('app.acquire_runtime_id',true) runtime,current_setting('acquire.simulator_business_run',true) run,current_setting('acquire.simulator_business_time',true) stamp")).rows[0]);}
 registerFixture(threadId:string,revision:number,runtimeId:string){return this.transaction(c=>c.query('SELECT public.agent_register_runtime($1::uuid,$2::integer,$3)',[threadId,revision,runtimeId]));}
 anchor(proof:Record<string,unknown>){return this.reconciliationBusinessAnchor(proof);}
 alterOperation(id:string,column:'business_completed_at'|'updated_at',value:string){return this.transaction(c=>c.query(`UPDATE agent_operations SET ${column}=$2::timestamptz WHERE id=$1`,[id,value]));}
}
function clockStore(f:typeof fixtures[number],stamp=f.stamp,runId=f.runId){const scope={runId,organizationId:f.organizationId,userId:f.userId};return new ClockStore(runtimePool(f.runtimeId),{organizationId:f.organizationId,userId:f.userId},{businessTime:{context:createAgentBusinessTimeContext(scope,{now:()=>Date.parse(stamp)}),scope}});}
async function seed(work:(c:PoolClient)=>Promise<void>){const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await work(c);await c.query('COMMIT');}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}}

describe.runIf(enabled)('SIM28 marked local business clock foundation and real operational time',()=>{
 beforeAll(async()=>{
  expect((await pool.query("SELECT current_database() database,shobj_description(d.oid,'pg_database') marker,(SELECT system_identifier::text FROM pg_control_system()) system FROM pg_database d WHERE d.datname=current_database()")).rows[0]).toEqual({database:'acquire_agent_mode',marker:'acquire-agent-mode-local-only',system:'7697400069962248225'});attested=true;
  vi.stubEnv('AGENT_WORKER_SCOPE_MODE','exact');vi.stubEnv('AGENT_WORKER_RUNTIME_ID',undefined);
  await seed(async c=>{for(const f of fixtures){await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[f.userId,f.userId+'@example.invalid']);await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[f.organizationId]);await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),f.organizationId,f.userId]);await c.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic SIM28 clock foundation','{}','{}',$3)",[f.mandateId,f.organizationId,f.userId]);if(f!==fixtures[2])await c.query('INSERT INTO local_simulator_business_runs(run_id,organization_id,owner_user_id,runtime_id) VALUES($1,$2,$3,$4)',[f.runId,f.organizationId,f.userId,f.runtimeId]);}});
  for(const f of fixtures)f.threadId=(await (f===fixtures[2]?new ClockStore(runtimePool(f.runtimeId),{organizationId:f.organizationId,userId:f.userId}):clockStore(f)).openThread(f.mandateId)).id;
 });
 afterAll(async()=>{
  try{if(attested)await seed(async c=>{for(const f of fixtures){for(const table of ['agent_runtime_registrations','agent_budget_reservations','agent_authority_uses','agent_review_batches','agent_operations','agent_handoffs','agent_person_claims','agent_conversations','agent_budget_accounts','agent_runs','agent_events','agent_messages','agent_responsibilities','agent_threads','audit_events','mandates','member','communication_send_gates'])await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[f.organizationId]);await c.query('DELETE FROM local_simulator_business_runs WHERE run_id=$1 AND runtime_id=$2 AND organization_id=$3 AND owner_user_id=$4',[f.runId,f.runtimeId,f.organizationId,f.userId]);await c.query('DELETE FROM organization WHERE id=$1',[f.organizationId]);await c.query('DELETE FROM "user" WHERE id=$1',[f.userId]);}});
   if(attested){expect((await pool.query('SELECT count(*)::int n FROM local_simulator_business_runs WHERE run_id=ANY($1::text[])',[fixtures.map(f=>f.runId)])).rows[0].n).toBe(0);expect((await pool.query('SELECT count(*)::int n FROM organization WHERE id=ANY($1::text[])',[fixtures.map(f=>f.organizationId)])).rows[0].n).toBe(0);}
  }finally{vi.unstubAllEnvs();await pool.end();}
 });
 it('isolates concurrent2030/2040 contexts on the same actual pooled connection and clears all local settings',async()=>{
  const reads=await Promise.all(Array.from({length:12},(_,i)=>clockStore(fixtures[i%2]).inspect()));
  expect(new Set(reads.map(r=>r.pid)).size).toBe(1);
  for(let i=0;i<reads.length;i++){const f=fixtures[i%2],r=reads[i];expect(r.business_at.toISOString()).toBe(f.stamp);expect(r).toMatchObject({role:'acquire_agent_user',org:f.organizationId,owner:f.userId,runtime:f.runtimeId,run:f.runId,stamp:f.stamp});expect(Math.abs(r.wall_at.getTime()-Date.now())).toBeLessThan(5000);}
  const clean=(await pool.query("SELECT current_user role,nullif(current_setting('app.acquire_org',true),'') org,nullif(current_setting('app.acquire_user',true),'') owner,nullif(current_setting('app.acquire_runtime_id',true),'') runtime,nullif(current_setting('acquire.simulator_business_run',true),'') run,nullif(current_setting('acquire.simulator_business_time',true),'') stamp")).rows[0];expect(clean).toEqual({role:'project_acquire',org:null,owner:null,runtime:null,run:null,stamp:null});
 });
 it('uses the actual per-operation pool adapter with independent contexts and restricted normal stores',async()=>{
  const stores=fixtures.slice(0,2).map(f=>{const actor={organizationId:f.organizationId,userId:f.userId},scope={runId:f.runId,...actor},businessTime={context:createAgentBusinessTimeContext(scope,{now:()=>Date.parse(f.stamp)}),scope};return new ClockStore(agentBusinessTimePool(pool,{runtimeId:f.runtimeId,businessTime}),actor,{businessTime});});
  const values=await Promise.all([stores[0].inspect(),stores[1].inspect(),stores[0].inspect(),stores[1].inspect()]);
  for(let i=0;i<values.length;i++){expect(values[i].business_at.toISOString()).toBe(fixtures[i%2].stamp);expect(values[i].role).toBe('acquire_agent_user');expect(values[i].runtime).toBe(fixtures[i%2].runtimeId);}
  expect(new Set(values.map(v=>v.pid)).size).toBe(1);
  expect((await pool.query("SELECT nullif(current_setting('acquire.simulator_business_run',true),'') run,nullif(current_setting('acquire.simulator_business_time',true),'') stamp,nullif(current_setting('app.acquire_runtime_id',true),'') runtime")).rows[0]).toEqual({run:null,stamp:null,runtime:null});
 });
 it('refuses missing configured clock context even when a producer explicitly writes wall time',async()=>{
  const f=fixtures[0],missing=new ClockStore(runtimePool(f.runtimeId),{organizationId:f.organizationId,userId:f.userId});
  await expect(missing.inspect()).rejects.toThrow('Configured local clock context missing');
  await expect(missing.enqueueEvent(f.threadId,'missing-clock','sim28.fixture',{})).rejects.toThrow('Configured local clock context missing');
 });
 it('refuses foreign run contexts while an unregistered default stays on wall time',async()=>{
  const f=fixtures[0];
  await expect(clockStore(f,f.stamp,fixtures[1].runId).inspect()).rejects.toThrow('Exact registered business clock scope required');
  await expect(new ClockStore(runtimePool('sim28-unregistered-'+randomUUID()),{organizationId:f.organizationId,userId:f.userId}).inspect()).rejects.toThrow('Configured local clock context missing');
  const ordinary=fixtures[2],wall=new ClockStore(runtimePool(ordinary.runtimeId),{organizationId:ordinary.organizationId,userId:ordinary.userId}),before=Date.now(),value=await wall.inspect();expect(value.business_at.getTime()).toBeGreaterThanOrEqual(before);expect(value.business_at.getTime()).toBeLessThanOrEqual(Date.now());expect(value.run??'').toBe('');expect(value.stamp??'').toBe('');
  expect((await pool.query('SELECT count(*)::int n FROM agent_events WHERE organization_id=$1',[f.organizationId])).rows[0].n).toBe(0);
 });
 it('does not expire a live real lease or burn attempts through business years and keeps real retry backoff pending',async()=>{
  const f=fixtures[0],store=clockStore(f),later=clockStore(f,'2050-01-07T00:00:00.000Z'),state=await store.executionState(f.threadId),responsibility=await store.controlResponsibility(f.threadId,randomUUID(),{action:'start',expectedRevision:0,mandateRevision:state.mandateRevision});
  await store.registerFixture(f.threadId,responsibility.revision,f.runtimeId);
  // Only fixture setup notices exist: remove their queued work without running a
  // model/worker so the single lease target is the only candidate in this scope.
  await seed(async c=>{await c.query('DELETE FROM agent_events WHERE organization_id=$1 AND thread_id=$2',[f.organizationId,f.threadId]);});
  const event=await store.enqueueEvent(f.threadId,'real-lease','sim28.fixture',{}),claimed=await store.claimEvent(randomUUID(),30000,f.mandateId);expect(claimed?.id).toBe(event.id);
  expect(await later.claimEvent(randomUUID(),30000,f.mandateId)).toBeUndefined();
  let row=(await pool.query('SELECT *,lease_until>clock_timestamp() AND lease_until<clock_timestamp()+interval \'60 seconds\' real_lease FROM agent_events WHERE id=$1',[event.id])).rows[0];expect(row.attempts).toBe(1);expect(row.real_lease).toBe(true);expect(row.available_at.toISOString()).toBe(f.stamp);
  const wake=new Date(Date.now()+3600000).toISOString();expect(await later.deferEvent(claimed!,wake)).toBe(true);expect(await clockStore(f,'2060-01-07T00:00:00.000Z').claimEvent(randomUUID(),30000,f.mandateId)).toBeUndefined();
  row=(await pool.query('SELECT * FROM agent_events WHERE id=$1',[event.id])).rows[0];expect(row.state).toBe('pending');expect(row.attempts).toBe(1);expect(row.operational_not_before_at.toISOString()).toBe(wake);expect(row.available_at.toISOString()).toBe(f.stamp);expect(row.lease_until).toBeNull();
 });
 it('anchors an actual native command once at business completion, never a later mutable audit timestamp',async()=>{
  const f=fixtures[1],store=clockStore(f),state=await store.executionState(f.threadId),request=randomUUID(),input={action:'start',expectedRevision:0,mandateRevision:state.mandateRevision};await store.controlResponsibility(f.threadId,request,input);
  const original=(await pool.query("SELECT * FROM agent_operations WHERE organization_id=$1 AND name='control.start'",[f.organizationId])).rows[0];expect(original.state).toBe('complete');expect(original.business_completed_at.toISOString()).toBe(f.stamp);expect(original.updated_at.getUTCFullYear()).toBe(new Date().getUTCFullYear());
  await expect(store.alterOperation(original.id,'business_completed_at','2040-01-08T00:00:00.000Z')).rejects.toThrow('Original business completion is immutable');
  await store.alterOperation(original.id,'updated_at','2045-01-07T00:00:00.000Z');
  const later=clockStore(f,'2050-01-07T00:00:00.000Z');await later.controlResponsibility(f.threadId,request,input);const proof=(await pool.query('SELECT * FROM agent_operations WHERE id=$1',[original.id])).rows[0];expect(proof.business_completed_at.toISOString()).toBe(f.stamp);expect(proof.updated_at.toISOString()).toBe('2045-01-07T00:00:00.000Z');expect(later.anchor(proof).toISOString()).toBe(f.stamp);expect(()=>later.anchor({updated_at:proof.updated_at})).toThrow('Business reconciliation anchor unavailable');
  expect((await pool.query('SELECT count(*)::int n FROM agent_runtime_registrations WHERE organization_id=$1',[f.organizationId])).rows[0].n).toBe(0);
 });
});
