import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {AgentDemoProvisioningStore} from './agent-demo-provisioning-store';
import {agentRecordDigest} from './agent-store';
import type {AgentDemoParticipantsResult} from '@/lib/agent-demo-client';
vi.mock('server-only',()=>({}));
const enabled=process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
const org=randomUUID(),owner=randomUUID(),other=randomUUID(),foreignOrg=randomUUID(),foreignUser=randomUUID(),contact=randomUUID(),target=randomUUID(),registry=randomUUID(),firmablePerson=randomUUID();
const real=randomUUID(),demos=[randomUUID(),randomUUID()],mandates=[real,...demos],runId='agent-native-context-'+registry.slice(0,8),integration='sim-'+runId,config=integration+'-v1';
const channels=['email','whatsapp','linkedin'] as const,bindings=channels.map(channel=>({channel,id:randomUUID(),connection:randomUUID(),account:randomUUID()}));
const ordinary={channel:'email',id:randomUUID(),connection:randomUUID(),account:randomUUID()};
const original={email:'genuine-source@example.invalid',phone:'+61412345678',linkedinUrl:'https://www.linkedin.com/in/synthetic-real-source',companyName:'Synthetic researched company',doNotContact:false};
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
let senders:Array<{channel:string;bindingId:string;bindingDigest:string;accountId:string;providerAccountId:string;sourceId:string}>;
describe.runIf(enabled)('batched demo provisioning against isolated PostgreSQL',()=>{
 beforeAll(async()=>{
  expect((await pool.query("SELECT current_database() name,shobj_description(oid,'pg_database') marker FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
   for(const user of[owner,other,foreignUser])await c.query('INSERT INTO public."user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);
   for(const id of[org,foreignOrg])await c.query('INSERT INTO public.organization(id,name,slug) VALUES($1,$1,$1)',[id]);
   for(const [user,scope]of[[owner,org],[other,org],[foreignUser,foreignOrg]])await c.query("INSERT INTO public.member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),scope,user]);
   await c.query("INSERT INTO public.targets(id,organization_id,company_name,firmographics) VALUES($1,$2,'Synthetic researched company','{}')",[target,org]);
   for(const mandate of mandates){await c.query("INSERT INTO public.mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic demo source','{}','{}',$3)",[mandate,org,owner]);await c.query("INSERT INTO public.agent_mandate_execution_modes(mandate_id,organization_id,created_by,mode,demo_id) VALUES($1,$2,$3,$4,$5)",[mandate,org,owner,mandate===real?'real':'demo',mandate===real?null:mandate]);await c.query("INSERT INTO public.mandate_targets(organization_id,mandate_id,target_id,assessment) VALUES($1,$2,$3,'{}')",[org,mandate,target]);}
   await c.query("INSERT INTO public.firmable_people(id,name) VALUES($1,'Synthetic source person')",[firmablePerson]);
   await c.query("INSERT INTO public.contacts(id,organization_id,mandate_id,target_id,display_name,role,personal_data,provenance,fictionalised,firmable_person_id) VALUES($1,$2,$3,$4,'Synthetic source person','Owner',$5,$6,false,$7)",[contact,org,real,target,JSON.stringify(original),JSON.stringify({source:'Synthetic researched fixture'}),firmablePerson]);
   for(const b of [...bindings,ordinary]){const platform=b.channel==='email'?'gmail':b.channel;
    await c.query("INSERT INTO communications.connections(id,application_id,tenant_id,owner_id,account_id,channel,platform,backend,current_generation,status,active) VALUES($1,'acquire',$2,$3,$4,$5,$6,'unipile',1,'connected',true)",[b.connection,org,owner,b.account,b.channel,platform]);
    await c.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,authority,capabilities) VALUES($1,1,'acquire',$2,$3,$4,$5,$6,'unipile',$7,'v1',$8,'service','{}')",[b.connection,org,owner,b.account,b.channel,platform,b===ordinary?'synthetic-ordinary-runtime':integration,b===ordinary?'synthetic-ordinary-runtime-v1':config]);
    await c.query("INSERT INTO public.communication_bindings(id,organization_id,owner_user_id,service_connection_id,service_account_id,generation,channel,platform,backend,authority) VALUES($1,$2,$3,$4,$5,1,$6,$7,'unipile','service')",[b.id,org,owner,b.connection,b.account,b.channel,platform]);
   }await c.query('COMMIT');
   senders=[];for(const b of bindings){const digest=(await c.query('SELECT public.agent_recorded_binding_digest($1) digest',[b.id])).rows[0].digest;senders.push({channel:b.channel,bindingId:b.id,bindingDigest:digest,accountId:b.account,providerAccountId:`sim-${runId}-${b.channel}`,sourceId:`sim-source-${b.channel}`});}
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 });
 afterAll(async()=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  for(const table of['agent_demo_contact_mappings','agent_demo_mapping_receipts','agent_demo_mapping_requests','agent_demo_runs'])if((await c.query('SELECT to_regclass($1) IS NOT NULL present',['public.'+table])).rows[0].present)await c.query(`DELETE FROM public.${table} WHERE organization_id=$1`,[org]);
  for(const table of['agent_operations','agent_conversations','agent_responsibilities','agent_threads','agent_mandate_execution_modes','contacts','mandate_targets','targets','mandates','member','communication_bindings','communication_send_gates'])await c.query(`DELETE FROM public.${table} WHERE organization_id=ANY($1::text[])`,[[org,foreignOrg]]);
  await c.query('DELETE FROM public.firmable_people WHERE id=$1',[firmablePerson]);
  await c.query('DELETE FROM communications.connection_generations WHERE tenant_id=$1',[org]);await c.query('DELETE FROM communications.connections WHERE tenant_id=$1',[org]);await c.query('DELETE FROM public.organization WHERE id=ANY($1::text[])',[[org,foreignOrg]]);await c.query('DELETE FROM public."user" WHERE id=ANY($1::text[])',[[owner,other,foreignUser]]);await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await pool.end();}});
 async function scope(c:PoolClient,user=owner,organization=org,role?:string){await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[organization,user]);await c.query('SELECT public.communications_lock_send_gate($1)',[organization]);if(role)await c.query('SET LOCAL ROLE '+role);}
 async function tx(work:(c:PoolClient)=>Promise<void>){const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await scope(c);await c.query('INSERT INTO public.agent_demo_runs(id,organization_id,owner_user_id,run_id,integration_id,configuration_ref,senders) VALUES($1,$2,$3,$4,$5,$6,$7)',[registry,org,owner,runId,integration,config,JSON.stringify(senders)]);await work(c);}finally{await c.query('ROLLBACK');c.release();}}
 async function evidence(c:PoolClient,demo=demos[0],ordinal=1,requestOnly=false){
  const requestKey=randomUUID(),sourceRevision=(await c.query('SELECT xmin::text revision FROM public.contacts WHERE id=$1',[contact])).rows[0].revision,sourceFingerprint=(await c.query('SELECT public.agent_demo_contact_fingerprint($1) hash',[contact])).rows[0].hash;
  const person={sourcePersonId:contact,sourceRevision,sourceFingerprint},manifest={version:1,demoId:demo,organizationId:org,userId:owner,mandateId:demo,requestKey,people:[person]},lead='lead-'+String(ordinal).padStart(3,'0');
  const wire={...person,simulatorLeadId:lead,email:`${lead}@${runId}.leads.acquire.test`,phone:'+999'+String(parseInt(registry.slice(0,8),16)).padStart(10,'0')+String(ordinal).padStart(2,'0'),linkedin:`https://www.linkedin.com/in/sim-${runId}-${lead}`,providerId:`ACo_sim_${runId}_${lead}`};
  const mappingDigest=hash({version:1,runId,demoId:demo,organizationId:org,userId:owner,mandateId:demo,mappings:[wire]}),result={version:1,runId,demoId:demo,mappingDigest,mappings:[wire],accounts:senders.map(s=>({channel:s.channel,providerAccountId:s.providerAccountId,sourceId:s.sourceId})),limits:{participants:999,modelCalls:300,perPerson:6,perPersonChannel:2},usage:{participants:ordinal,modelCalls:0,remainingModelCalls:300},replayed:false};
  await c.query('INSERT INTO public.agent_demo_mapping_requests(request_key,organization_id,mandate_id,demo_id,created_by,demo_run_id,manifest,input_digest) VALUES($1,$2,$3,$3,$4,$5,$6,$7)',[requestKey,org,demo,owner,registry,JSON.stringify(manifest),requestOnly?agentRecordDigest(manifest):hash(manifest)]);
  if(requestOnly)return{id:'',requestKey,wire,manifest,result,sourceRevision,sourceFingerprint,mappingDigest};
  await c.query('INSERT INTO public.agent_demo_mapping_receipts(request_key,organization_id,mandate_id,demo_id,created_by,demo_run_id,result,result_digest) VALUES($1,$2,$3,$3,$4,$5,$6,$7)',[requestKey,org,demo,owner,registry,JSON.stringify(result),hash(result)]);
  const id=(await c.query('INSERT INTO public.agent_demo_contact_mappings(organization_id,mandate_id,demo_id,created_by,contact_id,source_revision,source_fingerprint,demo_run_id,request_key,wire,mapping_digest) VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',[org,demo,owner,contact,sourceRevision,sourceFingerprint,registry,requestKey,JSON.stringify(wire),mappingDigest])).rows[0].id;
  return{id,requestKey,wire,manifest,result,sourceRevision,sourceFingerprint,mappingDigest};
 }

 it('commits batched mappings through normal SQL triggers, preserves the real source, and replays the immutable receipt',async()=>tx(async c=>{
  const prepared=await evidence(c,demos[0],1,true),before=(await c.query('SELECT personal_data FROM contacts WHERE id=$1',[contact])).rows[0];
  const store=new AgentDemoProvisioningStore(pool,{organizationId:org,userId:owner},{runId,integrationId:integration,configurationReference:config});
  // Reuse the fixture's real scoped transaction so its normal outer rollback
  // contains every receipt/mapping and leaves no test rows behind.
  const internal=store as unknown as {transaction:<T>(work:(client:PoolClient)=>Promise<T>)=>Promise<T>};
  const transaction=vi.spyOn(internal,'transaction').mockImplementation(work=>work(c));
  try{
   const input={kind:'prepared' as const,manifest:prepared.manifest as never,run:{id:registry,runId,senders}};
   expect(await store.commit(input,prepared.result as AgentDemoParticipantsResult)).toBe(1);
   expect(await store.commit(input,prepared.result as AgentDemoParticipantsResult)).toBe(1);
   const saved=(await c.query('SELECT wire FROM agent_demo_contact_mappings WHERE demo_id=$1 AND contact_id=$2',[demos[0],contact])).rows;
   expect(saved).toEqual([{wire:prepared.wire}]);expect((await c.query('SELECT personal_data FROM contacts WHERE id=$1',[contact])).rows[0]).toEqual(before);
   expect((await c.query('SELECT count(*)::int AS n FROM agent_demo_mapping_receipts WHERE request_key=$1',[prepared.requestKey])).rows[0].n).toBe(1);
  }finally{transaction.mockRestore();}
 }));

});
