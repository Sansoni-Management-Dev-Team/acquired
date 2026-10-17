import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {Pool} from 'pg';
import {drizzle} from 'drizzle-orm/node-postgres';
import {randomUUID} from 'node:crypto';
vi.mock('server-only',()=>({}));
import {AcquisitionRepository} from './acquisition-repository';
import {emptyBrief} from '@/domain/acquisition';
import * as schema from './schema';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
const org=randomUUID(),user=randomUUID(),mandate=randomUUID(),repo=new AcquisitionRepository(org,drizzle(pool,{schema}));
describe.runIf(process.env.RUN_AGENT_LOCAL_INTEGRATION==='true')('shared mandate revision concurrency',()=>{
 beforeAll(async()=>{
  expect((await pool.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);await c.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic revision test','{}','{}',$3)",[mandate,org,user]);await c.query('COMMIT');}finally{c.release();}
 });
 afterAll(async()=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");for(const table of ['audit_events','mandates','member'])await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);await c.query('DELETE FROM organization WHERE id=$1',[org]);await c.query('DELETE FROM "user" WHERE id=$1',[user]);await c.query('COMMIT');}finally{c.release();await pool.end();}});
 it('admits exactly one competing edit and commits one audit with its new revision',async()=>{
  const base=await repo.getMandate(mandate);expect(base?.revision).toMatch(/^\d+$/);
  const writes=await Promise.allSettled(['Manual edit','Agent edit'].map(name=>repo.updateBrief({...emptyBrief(),name},user,mandate,base!.revision!)));
  expect(writes.filter(row=>row.status==='fulfilled'),JSON.stringify(writes.map(row=>row.status==='rejected'?{message:row.reason.cause?.message??row.reason.message}:row))).toHaveLength(1);expect(writes.filter(row=>row.status==='rejected')).toHaveLength(1);
  const winner=writes.find(row=>row.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof repo.updateBrief>>>;
  expect(await repo.getMandate(mandate)).toMatchObject({brief:{name:winner.value.brief.name},revision:winner.value.revision});expect(winner.value.revision).not.toBe(base!.revision);
  expect((await pool.query("SELECT count(*)::integer AS count FROM audit_events WHERE organization_id=$1 AND action='mandate.brief_saved'",[org])).rows[0].count).toBe(1);
 });
 it('rejects a nonmember and a foreign organisation without changing the brief',async()=>{
  const base=(await repo.getMandate(mandate))!;
  await expect(repo.updateBrief({...emptyBrief(),name:'Denied'},randomUUID(),mandate,base.revision!)).rejects.toThrow();
  await expect(new AcquisitionRepository(randomUUID(),drizzle(pool,{schema})).updateBrief(emptyBrief(),user,mandate,base.revision!)).rejects.toThrow();
  expect(await repo.getMandate(mandate)).toEqual(base);
 });
 it('rechecks membership after waiting for a concurrent revocation fence',async()=>{
  const base=(await repo.getMandate(mandate))!,c=await pool.connect();let write:Promise<unknown>|undefined;
  try{
   await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(7426619361492031::bigint)');
   write=repo.updateBrief({...emptyBrief(),name:'Revoked while waiting'},user,mandate,base.revision!).then(value=>({value}),()=>({denied:true}));
   let waiting=false;
   for(let attempt=0;attempt<100;attempt++){
    // PostgreSQL caches activity statistics for this long-lived blocker TX.
    // Refresh each poll and require this backend to be the actual blocker.
    await c.query('SELECT pg_stat_clear_snapshot()');
    const rows=(await c.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND pg_backend_pid()=ANY(pg_blocking_pids(pid)) AND query LIKE 'WITH gate AS MATERIALIZED%'")).rows;
    if(rows.length){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
   }
   expect(waiting).toBe(true);
   await c.query('DELETE FROM member WHERE organization_id=$1 AND user_id=$2',[org,user]);await c.query('COMMIT');
   expect(await write).toEqual({denied:true});expect(await repo.getMandate(mandate)).toEqual(base);
  }finally{await c.query('ROLLBACK');c.release();if(write)await write;}
 });
});
