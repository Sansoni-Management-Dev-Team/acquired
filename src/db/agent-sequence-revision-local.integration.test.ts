import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {saveCampaign} from '@/lib/campaign-service';
const enabled=process.env.RUN_AGENT_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
const org=randomUUID(),user=randomUUID(),mandate=randomUUID();
const actor={organizationId:org,userId:user};
describe.runIf(enabled)('shared sequence draft revision concurrency',()=>{
 beforeAll(async()=>{
  const identity=(await pool.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0];
  expect(identity).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);
  await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);
  await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);
  await c.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic conversation test','{}','{}',$3)",[mandate,org,user]);
  await c.query('COMMIT');}finally{c.release();}
  vi.stubEnv('DATABASE_URL','postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode');
  vi.stubEnv('COMMUNICATIONS_RUNTIME_ENABLED','false');
 });
 afterAll(async()=>{
  // Delete only this suite's synthetic tenant; never use a pilot user's thread.
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  for(const table of ['campaign_sequences','agent_runs','agent_events','agent_operations','agent_messages','agent_threads','mandates','member'])await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);
  await c.query('DELETE FROM organization WHERE id=$1',[org]);
  await c.query('DELETE FROM "user" WHERE id=$1',[user]);
  await c.query('COMMIT');}finally{c.release();}
  await pool.end();
  await (globalThis as typeof globalThis & {acquireCampaignPool?:Pool}).acquireCampaignPool?.end();
  vi.unstubAllEnvs();
 });

 it('admits one of two competing saves and keeps the winning content and version pin',async()=>{
  const sequence=randomUUID();
  const definition={schemaVersion:1 as const,steps:[]};
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('app.acquire_org',$1,true)",[org]);await c.query("SELECT communications_lock_send_gate($1)",[org]);
  await c.query("INSERT INTO campaign_sequences(id,organization_id,owner_user_id,mandate_id,name,draft) VALUES($1,$2,$3,$4,'Original',$5)",[sequence,org,user,mandate,JSON.stringify(definition)]);await c.query('COMMIT');}finally{c.release();}
  const initial=(await pool.query('SELECT xmin::text token FROM campaign_sequences WHERE id=$1',[sequence])).rows[0].token;
  const result=await Promise.allSettled([saveCampaign(actor,sequence,'Human change',definition,initial),saveCampaign(actor,sequence,'Agent change',definition,initial)]);
  expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(result.find(r=>r.status==='rejected')).toMatchObject({reason:{status:409}});
  const saved=(await pool.query('SELECT name,draft,published_version,xmin::text token FROM campaign_sequences WHERE id=$1',[sequence])).rows[0];
  const winner=result.find(r=>r.status==='fulfilled')! as PromiseFulfilledResult<Awaited<ReturnType<typeof saveCampaign>>>;
  expect(saved.name).toBe(winner.value.name);expect(saved.token).toBe(winner.value.draftRevision);expect(saved.token).not.toBe(initial);expect(saved.published_version).toBe(0);
  expect(saved.draft).toEqual(definition);
 });
});
