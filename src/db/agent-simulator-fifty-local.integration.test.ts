import {afterAll,expect,it} from 'vitest';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';

const enabled=process.env.RUN_AGENT_SIMULATOR_POLICY_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
const mandate='e7da3f8c-8c45-4aef-bac4-392b918e0050';
const integration='sim-agent-conversations-50-20261017';
const domain='agent-conversations-50-20261017.leads.acquire.test';
afterAll(()=>pool.end());

it.runIf(enabled)('admits the exact fifty-lead fixture and rejects crossed old/new identities',async()=>{
 const c=await pool.connect();
 try{
  expect((await c.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
  await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  // Restore any retained pilot row on ROLLBACK; never mutate its committed state.
  await c.query('DELETE FROM agent_simulator_test_policies WHERE mandate_id=$1',[mandate]);
  // FK-independent constraint characterization; every synthetic row rolls back.
  const insert=(id:string,provider:string,recipientDomain:string)=>c.query("INSERT INTO agent_simulator_test_policies(mandate_id,organization_id,owner_user_id,binding_id,binding_digest,channel,integration_id,recipient_domain,expires_at)VALUES($1,$2,$3,$4,$5,'email',$6,$7,clock_timestamp()+interval '1 hour')",[id,randomUUID(),randomUUID(),randomUUID(),'f'.repeat(64),provider,recipientDomain]);
  await expect(insert(mandate,integration,domain)).resolves.toMatchObject({rowCount:1});
  await c.query('DELETE FROM agent_simulator_test_policies WHERE mandate_id=$1',[mandate]);
  for(const args of [
   [mandate,'sim-agent-conversations-25-20261017',domain],
   [mandate,integration,'agent-conversations-25-20261017.leads.acquire.test'],
   ['e7da3f8c-8c45-4aef-bac4-392b918e0026',integration,domain],
   [randomUUID(),integration,domain],
  ]){
   await c.query('SAVEPOINT reject');
   await expect(insert(args[0],args[1],args[2])).rejects.toThrow(/check constraint/);
   await c.query('ROLLBACK TO reject');
  }
 }finally{await c.query('ROLLBACK');c.release();}
});

it.runIf(enabled)('requires the original fifty-lead owner, binding, provider generation and expiry',async()=>{
 const c=await pool.connect();
 try{
  expect((await c.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
  await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  // Restore any retained pilot row on ROLLBACK; never mutate its committed state.
  await c.query('DELETE FROM agent_simulator_test_policies WHERE mandate_id=$1',[mandate]);
  const org=randomUUID(),owner=randomUUID(),binding=randomUUID(),connection=randomUUID(),account=randomUUID(),hash='a'.repeat(64);
  await c.query("INSERT INTO communication_bindings(id,organization_id,owner_user_id,application_id,service_connection_id,service_account_id,generation,channel,platform,backend,authority)VALUES($1,$2,$3,'acquire',$4,$5,1,'email','gmail','unipile','service')",[binding,org,owner,connection,account]);
  await c.query("INSERT INTO communications.connections(id,application_id,tenant_id,owner_id,account_id,channel,platform,backend,current_generation,status,active)VALUES($1,'acquire',$2,$3,$4,'email','gmail','unipile',1,'connected',true)",[connection,org,owner,account]);
  await c.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,authority,capabilities)VALUES($1,1,'acquire',$2,$3,$4,'email','gmail','unipile',$5,'v1',$5||'-v1','service','{}')",[connection,org,owner,account,integration]);
  await c.query("INSERT INTO agent_simulator_test_policies(mandate_id,organization_id,owner_user_id,binding_id,binding_digest,channel,integration_id,recipient_domain,expires_at)VALUES($1,$2,$3,$4,$5,'email',$6,$7,clock_timestamp()+interval '1 hour')",[mandate,org,owner,binding,hash,integration,domain]);
  await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[org,owner]);
  const allowed=async(recipient='lead-050@'+domain)=>(await c.query('SELECT agent_simulator_window_exception($1,$2,$3,$4,clock_timestamp()) AS ok',[mandate,binding,hash,recipient])).rows[0].ok;
  expect(await allowed()).toBe(true);
  expect(await allowed('lead-001@agent-conversations-25-20261017.leads.acquire.test')).toBe(false);
  await c.query("SELECT set_config('app.acquire_user','foreign-owner',true)");expect(await allowed()).toBe(false);
  await c.query("SELECT set_config('app.acquire_user',$1,true)",[owner]);
  await c.query('SAVEPOINT original');
  await c.query('UPDATE communications.connections SET current_generation=2 WHERE id=$1',[connection]);expect(await allowed()).toBe(false);
  await c.query('ROLLBACK TO original');
  await c.query("UPDATE communications.connection_generations SET integration_id='sim-agent-conversations-25-20261017' WHERE connection_id=$1",[connection]);expect(await allowed()).toBe(false);
  await c.query('ROLLBACK TO original');
  await c.query("UPDATE agent_simulator_test_policies SET created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE mandate_id=$1",[mandate]);expect(await allowed()).toBe(false);
 }finally{await c.query('ROLLBACK');c.release();}
});
