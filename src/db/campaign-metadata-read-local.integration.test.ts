import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {withCampaignDb} from './campaign-client';
import {AgentStore} from './agent-store';
class SnapshotHarness extends AgentStore{read(sql:string){return this.transaction(c=>c.query(sql),undefined,true);}}
const enabled=process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode',query_timeout:3000});
const fixtures=Array.from({length:2},()=>({org:randomUUID(),user:randomUUID(),binding:randomUUID()}));let attested=false;
const insert=`INSERT INTO communication_bindings(id,organization_id,owner_user_id,application_id,service_connection_id,service_account_id,generation,channel,platform,backend,authority) VALUES($1,$2,$3,'acquire',$4,$5,1,'email','gmail','unipile','service')`;
const values=(f:typeof fixtures[number])=>[f.binding,f.org,f.user,randomUUID(),randomUUID()];
describe.runIf(enabled)('read-only communications metadata isolation',()=>{
 beforeAll(async()=>{
  expect((await pool.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});attested=true;
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");for(const f of fixtures){await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[f.user,f.user+'@example.invalid']);await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[f.org]);await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),f.org,f.user]);await c.query(insert,values(f));await c.query('INSERT INTO communication_send_gates(organization_id,writer_xid) VALUES($1,txid_current())',[f.org]);}await c.query('COMMIT');}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 });
 afterAll(async()=>{try{if(attested){const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");for(const f of fixtures){for(const table of ['communication_bindings','communication_send_gates','member'])await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[f.org]);await c.query('DELETE FROM organization WHERE id=$1',[f.org]);await c.query('DELETE FROM "user" WHERE id=$1',[f.user]);}await c.query('COMMIT');}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}}}finally{await pool.end();}});
 const actor={organizationId:fixtures[0].org,userId:fixtures[0].user};
 it('reads only the owned binding while the write gate is held',async()=>{
  const lock=await pool.connect();try{await lock.query('BEGIN');await lock.query('SELECT 1 FROM communication_send_gates WHERE organization_id=$1 FOR UPDATE',[actor.organizationId]);const rows=await withCampaignDb(actor,c=>c.query('SELECT id FROM communication_bindings'),{pool,readOnly:true});expect(rows.rows).toEqual([{id:fixtures[0].binding}]);}finally{await lock.query('ROLLBACK');lock.release();}
 });
 it('rejects writes at the database boundary',async()=>{await expect(withCampaignDb(actor,c=>c.query(insert,values({...fixtures[0],binding:randomUUID()})),{pool,readOnly:true})).rejects.toMatchObject({code:'25006'});});
 it('rejects a different organisation membership',async()=>{await expect(withCampaignDb({...actor,organizationId:fixtures[1].org},async()=>true,{pool,readOnly:true})).rejects.toThrow('no longer');});
 it('agent snapshots read owned bindings while the write gate is held',async()=>{const lock=await pool.connect();try{await lock.query('BEGIN');await lock.query('SELECT 1 FROM communication_send_gates WHERE organization_id=$1 FOR UPDATE',[actor.organizationId]);const rows=await new SnapshotHarness(pool,actor).read('SELECT id FROM communication_bindings');expect(rows.rows).toEqual([{id:fixtures[0].binding}]);}finally{await lock.query('ROLLBACK');lock.release();}});
 it('agent snapshots cannot perform a write',async()=>{await expect(new SnapshotHarness(pool,actor).read('INSERT INTO agent_messages DEFAULT VALUES')).rejects.toMatchObject({code:'25006'});});
 it('agent snapshots reject a foreign membership',async()=>{await expect(new SnapshotHarness(pool,{...actor,organizationId:fixtures[1].org}).read('SELECT 1')).rejects.toThrow('no longer');});

});
