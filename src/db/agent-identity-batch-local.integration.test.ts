import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {Pool,type PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {drizzle} from 'drizzle-orm/node-postgres';
import {assertNativeResearchPersistence} from '@/lib/agent-research-context';

// Separately gated: these rollback-only 2344-contact fixtures take the normal
// shared persistence gate, so run only after actual research writers are quiet.
const enabled=process.env.RUN_AGENT_IDENTITY_PERFORMANCE_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode',max:3});
const hash='a'.repeat(64);
async function fixture<T>(work:(c:PoolClient,f:{org:string;user:string;thread:string;contacts:string[];targets:string[];conversation:string;mandate:string;responsibility:string;mandateRevision:string})=>Promise<T>,actorScope=true){
 const c=await pool.connect(),org=randomUUID(),user=randomUUID(),mandate=randomUUID(),thread=randomUUID(),responsibility=randomUUID(),conversation=randomUUID();
 try{
  await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='3s'");await c.query("SET LOCAL lock_timeout='1s'");
  // Synthetic rows never commit, never register a runtime and never enqueue work.
  await c.query("SET LOCAL session_replication_role='replica'");
  await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);
  await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);
  await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);
  await c.query("INSERT INTO mandates(id,organization_id,created_by,natural_language,filters,provenance) VALUES($1,$2,$3,'Synthetic identity scale fixture','{}','{}')",[mandate,org,user]);
  await c.query('INSERT INTO agent_threads(id,organization_id,mandate_id,owner_user_id) VALUES($1,$2,$3,$4)',[thread,org,mandate,user]);
  await c.query("INSERT INTO agent_responsibilities(id,thread_id,organization_id,mandate_id,owner_user_id,state,mandate_revision) SELECT $1,$2,$3,$4,$5,'ready',xmin::text FROM mandates WHERE id=$4",[responsibility,thread,org,mandate,user]);
  const targets=(await c.query("INSERT INTO targets(organization_id,company_name,domain,firmographics) SELECT $1,'Synthetic company '||n,'identity-'||n||'.invalid','{}' FROM generate_series(1,20)n RETURNING id",[org])).rows.map(r=>r.id as string);
  await c.query('INSERT INTO mandate_targets(organization_id,mandate_id,target_id) SELECT $1,$2,unnest($3::uuid[])',[org,mandate,targets]);
  const contacts=(await c.query("INSERT INTO contacts(organization_id,mandate_id,target_id,display_name,personal_data,provenance,fictionalised) SELECT $1,$2,($3::uuid[])[1+((n-1)%20)],'Synthetic person '||n,jsonb_build_object('email','person-'||n||'@identity.invalid','doNotContact',false),'{}',false FROM generate_series(1,2344)n RETURNING id",[org,mandate,targets])).rows.map(r=>r.id as string);
  await c.query("INSERT INTO agent_conversations(id,thread_id,organization_id,mandate_id,owner_user_id,responsibility_id,contact_id,delivery_mode,binding_digest,recipient_email,driver_kind,history_revision) VALUES($1,$2,$3,$4,$5,$6,$7,'local_sink',$8,'synthetic@identity.invalid','agent',$8)",[conversation,thread,org,mandate,user,responsibility,contacts[0],hash]);
  await c.query("INSERT INTO agent_person_claims(organization_id,identity_key,conversation_id,owner_user_id) SELECT $1,'email:unrelated-'||n||'@identity.invalid',$2,$3 FROM generate_series(1,117)n",[org,conversation,user]);
  await c.query("SET LOCAL session_replication_role='origin'");const mandateRevision=(await c.query('SELECT xmin::text revision FROM mandates WHERE id=$1',[mandate])).rows[0].revision as string;if(actorScope)await c.query('SET LOCAL ROLE acquire_agent_user');await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[org,user]);if(actorScope)await c.query('SELECT agent_lock_send_gate()');
  return await work(c,{org,user,thread,contacts,targets,conversation,mandate,responsibility,mandateRevision});
 }finally{await c.query('ROLLBACK');c.release();}
}
describe.runIf(enabled)('shared identity readiness batches at 2344 contacts; bounded rollback-only three-client workload',()=>{
 beforeAll(async()=>{expect((await pool.query("SELECT current_database() name,shobj_description(oid,'pg_database') marker FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});expect((await pool.query('SELECT system_identifier::text id FROM pg_control_system()')).rows[0].id).toBe('7697400069962248225');});
 afterAll(()=>pool.end());
 it('returns all20 company readiness rows under the3s server limit for three independent GUI actors',async()=>{
  const timings=await Promise.all([0,1,2].map(()=>fixture(async(c,f)=>{const start=performance.now();const result=(await c.query('SELECT agent_people_company_snapshot($1,$2::uuid[],NULL) body',[f.thread,f.targets])).rows[0].body;expect(result.companies).toHaveLength(20);expect(result.companies.every((r:{blockedReasons:string[]})=>r.blockedReasons.includes('usable_cached_contact'))).toBe(true);return performance.now()-start;})));
  console.info(JSON.stringify({scenario:"three_readers",queryMilliseconds:timings}));
  expect(Math.max(...timings)).toBeLessThan(3000);
 },20000);
 it('finishes a genuine native persistence boundary after a GUI readiness reader releases its shared gate',async()=>{
  let ready!:()=>void,start!:()=>void;const readerReady=new Promise<void>(r=>{ready=r;}),writerStarted=new Promise<void>(r=>{start=r;});let writerPid=0,readerPid=0,observedReaderBlock=false;
  const writer=fixture(async(c,f)=>{writerPid=(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid;await readerReady;const began=performance.now();start();await assertNativeResearchPersistence(drizzle(c),{organizationId:f.org,mandateId:f.mandate,createdBy:f.user,config:{nativeAgent:{responsibilityId:f.responsibility,threadId:f.thread,responsibilityRevision:1,mandateRevision:f.mandateRevision}}});await c.query("INSERT INTO targets(organization_id,mandate_id,company_name,firmographics) VALUES($1,$2,'Synthetic native persistence result','{}')",[f.org,f.mandate]);return performance.now()-began;},false);
  const reader=fixture(async(c,f)=>{readerPid=(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid;ready();await writerStarted;const until=performance.now()+500;while(performance.now()<until){const blocked=(await pool.query('SELECT $2::int=ANY(pg_blocking_pids($1)) blocked',[writerPid,readerPid])).rows[0].blocked;if(blocked){observedReaderBlock=true;break;}await new Promise(r=>setTimeout(r,5));}expect(observedReaderBlock).toBe(true);const began=performance.now();expect((await c.query('SELECT agent_people_company_snapshot($1,$2::uuid[],NULL) body',[f.thread,f.targets])).rows[0].body.companies).toHaveLength(20);return performance.now()-began;});
  const results=await Promise.allSettled([reader,writer]);for(const result of results)if(result.status==='rejected')throw result.reason;
  const times=results.map(r=>r.status==='fulfilled'?r.value:Infinity);console.info(JSON.stringify({scenario:'gui_reader_native_writer',readerQueryMilliseconds:times[0],writerWaitAndPersistenceMilliseconds:times[1],observedReaderBlock}));expect(Math.max(...times)).toBeLessThan(1000);
 },20000);
 it('preserves exact key expansion without recursively merging an alias chain, source identities or other organizations',async()=>fixture(async(c,f)=>{
  await c.query('RESET ROLE');const [a,b,d,e]=f.contacts;
  await c.query("UPDATE contacts SET personal_data=$2 WHERE id=$1",[a,{email:' A@identity.invalid ',phone:'+61411111111'}]);
  await c.query("UPDATE contacts SET personal_data=$2 WHERE id=$1",[b,{email:'a@identity.invalid',phone:'+61422222222'}]);
  await c.query("UPDATE contacts SET personal_data=$2 WHERE id=$1",[d,{email:'d@identity.invalid',phone:'+61422222222'}]);
  await c.query("UPDATE contacts SET personal_data=$2 WHERE id=$1",[e,{email:'e@identity.invalid'}]);
  for(const id of[a,e])await c.query("INSERT INTO campaign_reply_identities(organization_id,owner_user_id,contact_id,channel,identity,source_identity,email,since) VALUES($1,$2,$3,'linkedin',$4,'shared-source-proof',$5,now())",[f.org,f.user,id,'provider-'+id,id+'@identity.invalid']);
  await c.query('SET LOCAL ROLE acquire_agent_user');
  // Run this golden characterization against the unchanged old entry points
  // before asking for the new batch, so preapply failure cannot hide an alias
  // assumption that never matched the existing safety contract.
  const original=(await c.query('SELECT agent_person_keys($1,$2) keys',[f.org,a])).rows[0];
  expect(original.keys).toEqual(expect.arrayContaining(['contact:'+a,'contact:'+b,'contact:'+e,'email:a@identity.invalid','whatsapp:+61411111111','linkedin:shared-source-proof']));
  expect(original.keys).not.toContain('whatsapp:+61422222222');expect(original.keys.filter((key:string)=>key.startsWith('contact:')).map((key:string)=>key.slice(8)).sort()).toEqual([a,b,e].sort());
  // Seed/matching length rules are intentionally different in the legacy
  // contract; preserve empty Firmable values and exclude oversized seed keys.
  await c.query('RESET ROLE');
  await c.query("INSERT INTO firmable_people(id,name) VALUES('','Synthetic empty identity fixture') ON CONFLICT DO NOTHING");
  const edgeData=[{email:'',phone:'not-a-phone',linkedinUrl:'https://example.invalid/in/a'},{email:'   '},{email:'x'.repeat(410)+'@identity.invalid'},{email:'x'.repeat(410)+'@identity.invalid'}];
  for(let i=0;i<edgeData.length;i++)await c.query('UPDATE contacts SET personal_data=$2,firmable_person_id=$3 WHERE id=$1',[f.contacts[i+4],edgeData[i],i<2?'':null]);
  const foreign=randomUUID(),foreignContact=randomUUID(),foreignTarget=randomUUID();await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[foreign]);await c.query("INSERT INTO targets(id,organization_id,company_name,firmographics) VALUES($1,$2,'Synthetic foreign company','{}')",[foreignTarget,foreign]);await c.query("INSERT INTO contacts(id,organization_id,target_id,display_name,personal_data,provenance,fictionalised) VALUES($1,$2,$3,'Synthetic foreign alias',$4,'{}',false)",[foreignContact,foreign,foreignTarget,{email:'a@identity.invalid',phone:'+61411111111'}]);
  await c.query('SET LOCAL ROLE acquire_agent_user');
  const selected=[a,b,d,e,...f.contacts.slice(4,8)];
  const golden=await c.query('SELECT p.id,agent_person_keys($1,p.id) keys FROM contacts p WHERE p.organization_id=$1 AND p.id=ANY($2::uuid[])',[f.org,selected]);
  const expectedAliases=(keys:string[])=>keys.filter(key=>key.startsWith('contact:')).map(key=>key.slice(8)).sort();
  expect(expectedAliases(golden.rows.find(r=>r.id===a).keys)).not.toContain(foreignContact);
  expect(golden.rows.find(r=>r.id===f.contacts[4]).keys).toContain('firmable:');
  expect(expectedAliases(golden.rows.find(r=>r.id===f.contacts[4]).keys)).toEqual(f.contacts.slice(4,6).sort());
  expect(golden.rows.find(r=>r.id===f.contacts[6]).keys).toEqual(['contact:'+f.contacts[6]]);
  expect(expectedAliases(golden.rows.find(r=>r.id===f.contacts[6]).keys)).toEqual([f.contacts[6]]);
  const rows=(await c.query('SELECT * FROM agent_contact_identity_batch($1,$2::uuid[])',[f.org,selected])).rows;
  for(const old of golden.rows){const next=rows.find(r=>r.contact_id===old.id);expect(next).toEqual({contact_id:old.id,identity_keys:old.keys,contact_aliases:expectedAliases(old.keys)});}
  const first=rows.find(r=>r.contact_id===a)!;
  expect(first.identity_keys).toEqual(expect.arrayContaining(['contact:'+a,'contact:'+b,'contact:'+e,'email:a@identity.invalid','whatsapp:+61411111111','linkedin:shared-source-proof']));
  expect(first.identity_keys).not.toContain('whatsapp:+61422222222');expect(first.contact_aliases.sort()).toEqual([a,b,e].sort());expect(first.contact_aliases).not.toContain(d);
  for(const row of rows){expect((await c.query('SELECT agent_person_keys($1,$2) keys',[f.org,row.contact_id])).rows[0]).toEqual({keys:row.identity_keys});}
  await expect(c.query('SELECT * FROM agent_contact_identity_batch($1,$2::uuid[])',[randomUUID(),[a]])).rejects.toThrow('Held canonical identity scope');
 }));
 it('requires the existing role, current member and held organization gate',async()=>fixture(async(c,f)=>{
  for(const denial of ['role','member','gate']as const){
   await c.query('SAVEPOINT denied_scope');await c.query('RESET ROLE');
   if(denial==='member')await c.query('DELETE FROM member WHERE organization_id=$1',[f.org]);
   if(denial==='gate')await c.query('DELETE FROM communication_send_gates WHERE organization_id=$1',[f.org]);
   if(denial!=='role')await c.query('SET LOCAL ROLE acquire_agent_user');
   await expect(c.query('SELECT * FROM agent_contact_identity_batch($1,$2::uuid[])',[f.org,[f.contacts[0]]])).rejects.toThrow('Held canonical identity scope');
   await c.query('ROLLBACK TO SAVEPOINT denied_scope');
  }
 }));
 it('keeps original unknown invitations blocking the same aliased person without creating or settling effects',async()=>fixture(async(c,f)=>{
  await c.query('RESET ROLE');await c.query("UPDATE contacts SET personal_data=jsonb_set(personal_data,'{doNotContact}','true') WHERE id=$1",[f.contacts[0]]);await c.query("INSERT INTO agent_person_claims(organization_id,identity_key,conversation_id,owner_user_id) VALUES($1,$2,$3,$4)",[f.org,'contact:'+f.contacts[0],f.conversation,f.user]);const op=randomUUID();await c.query("INSERT INTO agent_operations(id,thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,state,conversation_id) SELECT $1::uuid,c.thread_id,c.organization_id,c.mandate_id,c.owner_user_id,$1::text,'linkedin.invitation','{}',$3,'uncertain',c.id FROM agent_conversations c WHERE c.id=$2",[op,f.conversation,hash]);await c.query('SET LOCAL ROLE acquire_agent_user');
  expect((await c.query('SELECT agent_person_has_unresolved_sends($1,NULL) blocked',[f.contacts[0]])).rows[0].blocked).toBe(true);
  expect((await c.query('SELECT agent_person_has_unresolved_sends($1,NULL) blocked',[f.contacts[1]])).rows[0].blocked).toBe(false);
  const company=(await c.query('SELECT agent_people_company_snapshot($1,$2::uuid[],NULL) body',[f.thread,[f.targets[0]]])).rows[0].body.companies[0];expect(company.blockedReasons).toEqual(expect.arrayContaining(['previous_outreach_or_owned_company','suppressed_or_unresolved']));
  expect((await c.query('SELECT state FROM agent_operations WHERE id=$1',[op])).rows[0].state).toBe('uncertain');
 }));
});
