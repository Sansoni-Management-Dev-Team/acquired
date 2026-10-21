import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {Pool,type PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {agentRecordDigest} from '@/db/agent-store';
import {emptyBrief,briefToMandate,initialAssessment} from '@/domain/acquisition';
import {buildAgentResearchPlan} from '@/lib/agent-research-plan';
import {publishCompanyMembershipProjection} from '@/db/company-membership-projection-store';
// PREPARED ONLY: execute after specific 0089 approval/application. Every case
// stays in one rollback transaction; no migration, commit, worker/provider I/O.
const enabled=process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode',options:'-c statement_timeout=3000 -c lock_timeout=1000'});
let c:PoolClient,org:string,user:string,mandate:string,thread:string,operation:string,job:string,target:string,fid:string;
let plan:ReturnType<typeof buildAgentResearchPlan>;
describe.runIf(enabled)('0089 initial reviewed company and automatic basic People scope',()=>{
 beforeAll(async()=>{
  expect((await pool.query("SELECT current_database() name,shobj_description(oid,'pg_database') marker FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
  expect((await pool.query("SELECT to_regprocedure('public.agent_automatic_people_context(uuid,uuid,text)') IS NOT NULL installed")).rows[0].installed).toBe(true);
 });
 beforeEach(async()=>{
  c=await pool.connect();await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  org=randomUUID();user=randomUUID();mandate=randomUUID();thread=randomUUID();operation=randomUUID();job=randomUUID();target=randomUUID();fid='f'+BigInt('0x'+randomUUID().replaceAll('-',''));
  const responsibility=randomUUID(),child=randomUUID(),observation=randomUUID(),brief=emptyBrief();
  for(const[key,value]of[['subsectors','Fire protection maintenance'],['geography','VIC']])Object.assign(brief.criteria.find(item=>item.key===key)!,{value,state:'specified',confirmed:true});
  await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);
  await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);
  await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);
  await c.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic V5 acceptance fixture',$3,'{}',$4)",[mandate,org,JSON.stringify({...briefToMandate(brief),brief}),user]);
  const revision=(await c.query('SELECT xmin::text revision FROM mandates WHERE id=$1',[mandate])).rows[0].revision;
  await c.query('INSERT INTO agent_threads(id,organization_id,mandate_id,owner_user_id) VALUES($1,$2,$3,$4)',[thread,org,mandate,user]);
  await c.query("INSERT INTO agent_responsibilities(id,thread_id,organization_id,mandate_id,owner_user_id,state,mandate_revision) VALUES($1,$2,$3,$4,$5,'ready',$6)",[responsibility,thread,org,mandate,user,revision]);
  plan=buildAgentResearchPlan({productionPipeline:'hybrid-firmable-v1',discoveryPolicyVersion:5,companyIdentityPolicyVersion:1,researchJobId:job,responsibilityId:responsibility,responsibilityRevision:1,mandateRevision:revision,brief});
  const digest=agentRecordDigest({name:'research.start',input:plan}),manifest=[{operationId:operation,revision:1,digest,contextRevision:plan.contextRevision}];
  await c.query("INSERT INTO agent_operations(id,thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,state) VALUES($1::uuid,$2,$3,$4,$5,$1::text,'research.start',$6,$7,'running')",[operation,thread,org,mandate,user,JSON.stringify(plan),digest]);
  await c.query("INSERT INTO agent_review_batches(thread_id,organization_id,mandate_id,owner_user_id,request_key,manifest,manifest_digest,state,decided_by,decided_at) VALUES($1,$2,$3,$4,$5,$6,$7,'approved',$4,clock_timestamp())",[thread,org,mandate,user,randomUUID(),JSON.stringify(manifest),agentRecordDigest(manifest)]);
  const config={...plan.config,pipelineDesign:'hybrid-firmable-v1',researchRunId:job,nativeAgent:{version:1,operationId:operation,threadId:thread,responsibilityId:responsibility,responsibilityRevision:1,mandateRevision:revision,contextRevision:plan.contextRevision,providerAdmission:'required'}};delete(config as Partial<typeof config>).requestId;
  await c.query("INSERT INTO research_jobs(id,organization_id,mandate_id,created_by,status,config,seeds) VALUES($1,$2,$3,$4,'extracting',$5,'[]')",[job,org,mandate,user,JSON.stringify(config)]);
  await c.query("INSERT INTO firmable_companies(id,name) VALUES($1,'Synthetic V5 company')",[fid]);
  await c.query("INSERT INTO targets(id,organization_id,mandate_id,company_name,domain,firmable_company_id,firmographics,qualification,band) VALUES($1,$2,$3,'Synthetic V5 company',$4,$5,'{}','excluded','excluded')",[target,org,mandate,target+'.example.invalid',fid]);
  await c.query('INSERT INTO mandate_targets(organization_id,mandate_id,target_id,assessment) VALUES($1,$2,$3,$4)',[org,mandate,target,JSON.stringify({...initialAssessment,decisionOrigin:'automatic'})]);
  await c.query("INSERT INTO research_jobs(id,organization_id,mandate_id,created_by,status,config,seeds) VALUES($1,$2,$3,$4,'complete',$5,'[]')",[child,org,mandate,user,JSON.stringify({parentJobId:job,targetId:target,firmableCompanyId:fid})]);
  const facts={firmableCompanyId:fid,identifiers:{firmableId:fid},firmographics:{firmable:{firmableId:fid,description:'Fire system maintenance',capturedAt:'2026-10-19T00:00:00.000Z',rawResponse:{id:fid,name:'Synthetic V5 company',website:'https://'+target+'.example.invalid',region:{AU:{employee_count:30,address:{state:'VIC'}}}}}}};
  await c.query("INSERT INTO company_identity_observations(id,request_key,organization_id,mandate_id,job_id,created_by,source,source_facts,input_digest,observed_at) VALUES($1,$2,$3,$4,$5,$6,'{}',$7,$8,clock_timestamp())",[observation,randomUUID(),org,mandate,job,user,JSON.stringify(facts),agentRecordDigest(facts)]);
  await c.query('INSERT INTO company_identity_resolutions(observation_id,organization_id,target_id) VALUES($1,$2,$3)',[observation,org,target]);
  for(const scope of['organization','user:'+user,'mandate:'+mandate])for(const unit of['calls','usd_micro'])await c.query("INSERT INTO agent_budget_accounts(id,organization_id,scope_key,unit,window_start,window_end,cap,approved_by) VALUES($1,$2,$3,$4,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',$5,$6)",[randomUUID(),org,scope+':'+unit,unit,unit==='calls'?'100':'300000000',user]);
  await c.query("SET LOCAL session_replication_role='origin'");
  await publishCompanyMembershipProjection(c,{organizationId:org,userId:user},{mandateId:mandate,targetId:target});
  await c.query('SET LOCAL ROLE acquire_agent_user');await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[org,user]);
  await c.query('SELECT public.agent_lock_send_gate()');await c.query('SELECT public.agent_lock_member()');
  expect((await c.query('SELECT public.agent_prepare_hybrid_native_research($1) value',[operation])).rows[0].value.dispatchReady).toBe(true);
  expect((await c.query('SELECT public.agent_reserve_research_phase($1) value',[operation])).rows[0].value.ready).toBe(true);
 });
 afterEach(async()=>{if(c){await c.query('ROLLBACK');c.release();}});afterAll(async()=>pool.end());
 async function inspect(sql:string,args:unknown[]=[]){await c.query('RESET ROLE');try{return await c.query(sql,args);}finally{await c.query('SET LOCAL ROLE acquire_agent_user');}}
 async function seed(work:()=>Promise<unknown>){await c.query('RESET ROLE');await c.query("SET LOCAL session_replication_role='replica'");try{return await work();}finally{await c.query("SET LOCAL session_replication_role='origin'");await c.query('SET LOCAL ROLE acquire_agent_user');}}
 async function failure(work:()=>Promise<unknown>,message?:RegExp){await c.query('SAVEPOINT expected_error');try{if(message)await expect(work()).rejects.toThrow(message);else await expect(work()).rejects.toThrow();}finally{await c.query('ROLLBACK TO SAVEPOINT expected_error');}}
 async function context(){return(await c.query('SELECT public.agent_automatic_people_context($1,$2,$3) value',[operation,target,fid])).rows[0].value;}
 async function candidates(ids:string[]){await c.query('SELECT public.agent_record_automatic_people_candidates($1,$2,$3)',[operation,target,JSON.stringify(ids)]);}
 async function save(profile:Record<string,unknown>){return(await c.query('SELECT public.agent_save_automatic_people_profile($1,$2,$3) value',[operation,target,JSON.stringify(profile)])).rows[0].value as string|null;}
 async function attempt(requestClass:string,provider='firmable'){
  const id=randomUUID(),input={researchOperationId:operation,researchJobId:job,provider,requestClass,targetId:target,requestDigest:agentRecordDigest(id)};
  await c.query("INSERT INTO agent_operations(id,thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,state) VALUES($1::uuid,$2,$3,$4,$5,$1::text,'research.provider',$6,$7,'running')",[id,thread,org,mandate,user,JSON.stringify(input),agentRecordDigest({name:'research.provider',input})]);
  await c.query('SELECT public.agent_transfer_research_phase_attempt($1,$2)',[operation,id]);return id;
 }
 it('launches the exact initial joint scope with USD11 initial reserve and no future call escrow',async()=>{
  expect((await c.query('SELECT public.agent_prepare_hybrid_native_research($1) value',[operation])).rows[0].value).toMatchObject({jobId:job,dispatchReady:true});
  const accounts=(await inspect('SELECT unit,reserved::text FROM agent_budget_accounts WHERE organization_id=$1',[org])).rows;
  expect(accounts.filter(a=>a.unit==='calls').every(a=>a.reserved==='0')).toBe(true);
  expect(accounts.filter(a=>a.unit==='usd_micro').every(a=>a.reserved==='11000000')).toBe(true);
 });
 it('reserves each People physical attempt directly and preserves unknown original holds after phase closure',async()=>{
  await context();const id=await attempt('people_search');
  expect((await inspect('SELECT amount::text FROM agent_budget_reservations WHERE operation_id=$1',[id])).rows.map(a=>a.amount).sort()).toEqual(['1','1','1','1000000','1000000','1000000']);
  await seed(()=>c.query("UPDATE agent_operations SET state='uncertain',result='{\"actualCostMicroUsd\":null}' WHERE id=$1",[id]));
  await c.query("UPDATE agent_operations SET state='complete' WHERE id=$1",[operation]);
  const accounts=(await inspect('SELECT unit,reserved::text FROM agent_budget_accounts WHERE organization_id=$1',[org])).rows;
  expect(accounts.filter(a=>a.unit==='calls').every(a=>a.reserved==='1')).toBe(true);
  expect(accounts.filter(a=>a.unit==='usd_micro').every(a=>a.reserved==='1000000')).toBe(true);
 });
 it('denies automatic phone and unknown classes and caps actual People search attempts per target',async()=>{
  await context();await failure(()=>attempt('phone_reveal'),/nonphone/);await failure(()=>attempt('unsupported'),/nonphone/);
  await attempt('people_search');await attempt('people_search');await failure(()=>attempt('people_search'),/physical People attempts/);
 });
 it('lets company reads retain zero configured cost when People money is unavailable',async()=>{
  await context();await seed(()=>c.query("UPDATE agent_budget_accounts SET cap=11000000 WHERE organization_id=$1 AND unit='usd_micro'",[org]));
  await failure(()=>attempt('people_search'),/request budget exhausted/);const company=await attempt('company_profile');
  expect((await inspect("SELECT r.amount::text FROM agent_budget_reservations r JOIN agent_budget_accounts a ON a.id=r.account_id WHERE r.operation_id=$1 AND a.unit='usd_micro'",[company])).rows.map(a=>a.amount)).toEqual(['0','0','0']);
 });
 it.each(['automatic','manual'])('distinguishes projected %s exclusion before admitting basic People',async origin=>{
  await seed(async()=>{await c.query("UPDATE mandate_targets SET version=version+1,assessment=assessment||jsonb_build_object('stage','excluded','decisionOrigin',$4::text) WHERE organization_id=$1 AND mandate_id=$2 AND target_id=$3",[org,mandate,target,origin]);await publishCompanyMembershipProjection(c,{organizationId:org,userId:user},{mandateId:mandate,targetId:target});});
  if(origin==='automatic')expect(await context()).toMatchObject({targetId:target,firmableId:fid,maxContactsPerCompany:3});
  else await failure(context,/explicitly available company membership/);
 });
 // PEOPLE CASES: rollback-only real persistence/source/privacy checks.
 function profile(id:string,extra:Record<string,unknown>={}){return{id,name:'Synthetic available name',position:'Owner',fictionalised:false,doNotContact:false,...extra};}
 function personId(){return 'fp'+BigInt('0x'+randomUUID().replaceAll('-',''));}
 it('persists canonical names and roles without requiring an email and creates no conversation or send',async()=>{
  const person=personId();await context();await candidates([person]);const contact=await save(profile(person));
  expect(contact).toMatch(/^[0-9a-f-]{36}$/);
  const saved=(await inspect('SELECT organization_id,mandate_id,target_id,firmable_person_id,display_name,role,personal_data,provenance,fictionalised FROM contacts WHERE id=$1',[contact])).rows[0];
  expect(saved).toMatchObject({organization_id:org,mandate_id:mandate,target_id:target,firmable_person_id:person,display_name:'Synthetic available name',role:'Owner',fictionalised:false,personal_data:{emailLookupStatus:'not_reported',phoneLookupStatus:'not_requested',doNotContact:false},provenance:{nativeAutomaticPeopleOperationId:operation}});
  expect(saved.personal_data).not.toHaveProperty('email');expect(saved.personal_data).not.toHaveProperty('phone');
  expect((await context()).outcomes).toEqual({[person]:{contactId:contact}});
  expect((await inspect('SELECT count(*)::int n FROM agent_conversations WHERE organization_id=$1',[org])).rows[0].n).toBe(0);
  expect((await inspect("SELECT count(*)::int n FROM agent_operations WHERE organization_id=$1 AND (name='research.provider' OR name LIKE 'email.%' OR name LIKE 'message.%')",[org])).rows[0].n).toBe(0);
 });
 it('retains available non-phone contact details while dropping incidental phone, WhatsApp and extra payload fields',async()=>{
  const exposure=async()=>(await inspect("SELECT (SELECT count(*)::int FROM agent_budget_reservations WHERE organization_id=$1) reservations,(SELECT count(*)::int FROM agent_research_phase_allocations WHERE organization_id=$1) phase_allocations,(SELECT count(*)::int FROM agent_operations WHERE organization_id=$1 AND name='research.provider') provider_operations,(SELECT count(*)::int FROM agent_operations WHERE organization_id=$1 AND (name LIKE 'email.%' OR name LIKE 'message.%')) send_operations",[org])).rows[0];
  const before=await exposure();expect(before).toEqual({reservations:0,phase_allocations:6,provider_operations:0,send_operations:0});
  const person=personId();await context();await candidates([person]);const contact=await save(profile(person,{email:'synthetic-owner@example.invalid',linkedinUrl:'https://www.linkedin.com/in/synthetic-owner',phone:'+61400000000',phones:[{value:'+61400000000'}],whatsapp:'+61400000000',phoneAvailable:true,phoneLookupStatus:'revealed',unexpected:'not-for-canonical-storage'}));
  const saved=(await inspect('SELECT personal_data,provenance FROM contacts WHERE id=$1',[contact])).rows[0];
  expect(saved.personal_data).toEqual({email:'synthetic-owner@example.invalid',linkedinUrl:'https://www.linkedin.com/in/synthetic-owner',emailLookupStatus:'reported',phoneLookupStatus:'not_requested',doNotContact:false});
  expect(JSON.stringify(saved)).not.toContain('+61400000000');expect(JSON.stringify(saved)).not.toContain('not-for-canonical-storage');
  expect(await exposure()).toEqual(before);
 });
 it('replays the original recorded outcome without altering the canonical person or creating another contact',async()=>{
  const person=personId();await context();await candidates([person]);const original=profile(person);const contact=await save(original);
  const before=(await inspect('SELECT to_jsonb(p) value FROM contacts p WHERE id=$1',[contact])).rows[0].value;
  expect(await save({...original,name:'Changed replay name',position:'Changed replay role',email:'replay@example.invalid',phone:'+61400000000'})).toBe(contact);
  expect((await inspect('SELECT to_jsonb(p) value FROM contacts p WHERE id=$1',[contact])).rows[0].value).toEqual(before);
  expect((await inspect('SELECT count(*)::int n FROM contacts WHERE organization_id=$1 AND firmable_person_id=$2',[org,person])).rows[0].n).toBe(1);
  expect((await context()).outcomes).toEqual({[person]:{contactId:contact}});
 });
 it('rechecks an edited accepted source before recording any personal result',async()=>{
  const person=personId(),before=await context();await candidates([person]);
  await seed(async()=>{await c.query("UPDATE mandate_targets SET version=version+1,assessment=assessment||'{\"notes\":\"Synthetic human company review\"}'::jsonb WHERE organization_id=$1 AND mandate_id=$2 AND target_id=$3",[org,mandate,target]);await publishCompanyMembershipProjection(c,{organizationId:org,userId:user},{mandateId:mandate,targetId:target});});
  await failure(()=>save(profile(person)),/source changed|projection requires refresh/);
  expect((await inspect('SELECT count(*)::int n FROM contacts WHERE organization_id=$1',[org])).rows[0].n).toBe(0);
  const snapshot=(await inspect("SELECT config->'automaticPeopleCompanies'->$2 value FROM research_jobs WHERE id=$1",[job,target])).rows[0].value;
  expect(snapshot.sourceRevision).toBe(before.sourceRevision);expect(snapshot.outcomes).toBeUndefined();
 });
 it('preserves a new opt-out and rejects later personal writes without erasing the original outcome',async()=>{
  const first=personId(),second=personId();await context();await candidates([first,second]);const contact=await save(profile(first,{doNotContact:true}));
  await failure(()=>save(profile(second)),/Opt-out|suppression/);
  expect((await inspect('SELECT personal_data FROM contacts WHERE id=$1',[contact])).rows[0].personal_data.doNotContact).toBe(true);
  expect((await inspect('SELECT count(*)::int n FROM contacts WHERE organization_id=$1',[org])).rows[0].n).toBe(1);
  expect((await inspect("SELECT config->'automaticPeopleCompanies'->$2->'outcomes' value FROM research_jobs WHERE id=$1",[job,target])).rows[0].value).toEqual({[first]:{contactId:contact}});
 });
 it('preserves existing human fields and does not mark incoming fictionalised data as genuine',async()=>{
  const person=personId(),contact=randomUUID();await context();await candidates([person]);
  await seed(async()=>{await c.query("INSERT INTO firmable_people(id,name) VALUES($1,'Synthetic cached person')",[person]);await c.query("INSERT INTO contacts(id,organization_id,mandate_id,target_id,firmable_person_id,display_name,role,personal_data,provenance,fictionalised) VALUES($1,$2,$3,$4,$5,'Human name','Human role','{\"humanNote\":\"Keep this note\",\"doNotContact\":false}','{\"source\":\"Human research\"}',false)",[contact,org,mandate,target,person]);});
  expect(await save(profile(person,{name:'Provider replacement name',position:'Provider replacement role',fictionalised:true}))).toBe(contact);
  const saved=(await inspect('SELECT display_name,role,personal_data,provenance,fictionalised FROM contacts WHERE id=$1',[contact])).rows[0];
  expect(saved).toMatchObject({display_name:'Human name',role:'Human role',fictionalised:true,personal_data:{humanNote:'Keep this note',doNotContact:false,phoneLookupStatus:'not_requested'},provenance:{source:'Human research',nativeAutomaticPeopleOperationId:operation}});
 });

});
