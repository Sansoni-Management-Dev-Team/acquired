import {it,expect,afterAll} from 'vitest';import {Pool} from 'pg';import {randomUUID} from 'node:crypto';
const enabled=process.env.RUN_AGENT_SIMULATOR_POLICY_LOCAL_INTEGRATION==='true',pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
afterAll(()=>pool.end());
it.runIf(enabled)('permits the exact isolated second pilot mandate, rejects arbitrary expansion',async()=>{
 const c=await pool.connect();try{
  expect((await c.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
  await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  // The retained real pilot policy is restored by the finally ROLLBACK.
  await c.query('DELETE FROM agent_simulator_test_policies WHERE mandate_id=$1',['e7da3f8c-8c45-4aef-bac4-392b918e0026']);
  const insert=(mandate:string)=>c.query("INSERT INTO agent_simulator_test_policies(mandate_id,organization_id,owner_user_id,binding_id,binding_digest,channel,integration_id,recipient_domain,expires_at)VALUES($1,$2,$3,$4,$5,'email','sim-agent-conversations-25-20261017','agent-conversations-25-20261017.leads.acquire.test',clock_timestamp()+interval '1 hour')",[mandate,randomUUID(),randomUUID(),randomUUID(),'f'.repeat(64)]);
  await expect(insert('e7da3f8c-8c45-4aef-bac4-392b918e0026')).resolves.toMatchObject({rowCount:1});
  await c.query('SAVEPOINT invalid');await expect(insert(randomUUID())).rejects.toThrow(/check constraint/);await c.query('ROLLBACK TO invalid');
 }finally{await c.query('ROLLBACK');c.release();}
});
