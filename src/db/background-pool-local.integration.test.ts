import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import {Pool} from 'pg';
import {backgroundPool} from './background-pool';
import {BackgroundAdmission,withBackgroundBudget} from '@/lib/background-workload';
const enabled=process.env.RUN_BACKGROUND_DB_LOCAL==='true';
const physical=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode',max:2,connectionTimeoutMillis:2000});
let bounded=backgroundPool(physical,new BackgroundAdmission());
beforeEach(()=>{bounded=backgroundPool(physical,new BackgroundAdmission());});
beforeAll(async()=>{if(!enabled)return;const result=await physical.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");expect(result.rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});});
afterAll(()=>physical.end());
it.runIf(enabled)('cancels a slow query on the server, rolls back and leaves no active sleep',async()=>{
 const start=performance.now();await expect(withBackgroundBudget('integration.statement',10000,()=>bounded.query('SELECT pg_sleep(8) /* background-budget-proof */'))).rejects.toMatchObject({code:'57014'});
 expect(performance.now()-start).toBeLessThan(4500);
 expect((await physical.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active' AND query LIKE '%background-budget-proof%'")).rows[0].n).toBe(0);
 expect((await physical.query('SELECT 1 AS ok')).rows[0].ok).toBe(1);
},10000);
it.runIf(enabled)('bounds a real lock wait without losing the pool connection',async()=>{
 const blocker=await physical.connect();try{
  await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(903214,782)');
  const start=performance.now();await expect(withBackgroundBudget('integration.lock',10000,()=>bounded.query('SELECT pg_advisory_xact_lock(903214,782)'))).rejects.toMatchObject({code:'55P03'});
  expect(performance.now()-start).toBeLessThan(1800);
 }finally{await blocker.query('ROLLBACK');blocker.release();}
 expect((await physical.query('SELECT 1 AS ok')).rows[0].ok).toBe(1);
});
it.runIf(enabled)('retires a connection at the overall deadline and prevents later work',async()=>{
 let pid=0;await expect(withBackgroundBudget('integration.total',200,async()=>{
  const client=await bounded.connect();try{await client.query('BEGIN');pid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;await client.query('SELECT pg_sleep(2)');}finally{client.release();}
 })).rejects.toThrow();
 await new Promise(resolve=>setTimeout(resolve,300));
 expect((await physical.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=$1 AND state=\'active\'',[pid])).rows[0].n).toBe(0);
});
it.runIf(enabled)('preserves Drizzle transaction and row-mode contracts',async()=>{
 const {drizzle}=await import('drizzle-orm/node-postgres');const {sql}=await import('drizzle-orm');const db=drizzle(bounded);
 const result=await withBackgroundBudget('integration.drizzle',10000,()=>db.transaction(async tx=>tx.execute(sql`SELECT 42 AS value`),{accessMode:'read only'}));
 expect(result.rows).toEqual([{value:42}]);
});
it.runIf(enabled)('makes background progress while every interactive connection is occupied',async()=>{
 const reserved=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode',max:1,connectionTimeoutMillis:2000});
 const held=await Promise.all([physical.connect(),physical.connect()]);
 try{const pool=backgroundPool(physical,new BackgroundAdmission(),reserved);const started=performance.now();expect((await withBackgroundBudget('integration.reserved',10000,()=>pool.query('SELECT 1 AS ok'))).rows[0].ok).toBe(1);expect(performance.now()-started).toBeLessThan(1500);}
 finally{held.forEach(c=>c.release());await reserved.end();}
});
