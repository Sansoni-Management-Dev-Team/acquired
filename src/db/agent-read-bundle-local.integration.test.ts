import {afterAll,beforeAll,expect,it} from 'vitest';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {AgentStore} from './agent-store';
const enabled=process.env.RUN_AGENT_READ_BUNDLE_LOCAL==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode',max:3,connectionTimeoutMillis:2000});
const actors=Array.from({length:2},()=>({organizationId:randomUUID(),userId:randomUUID()}));
class Store extends AgentStore{
 async snapshot(){return this.readBundle(async()=>{
  const read=()=>this.transaction(async c=>(await c.query("SELECT pg_backend_pid() AS pid,current_user AS role,current_setting('app.acquire_org') AS org,current_setting('app.acquire_user') AS actor")).rows[0]);
  return [await read(),await read()];
 });}
}
beforeAll(async()=>{if(!enabled)return;
 expect((await pool.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
 for(const a of actors){await pool.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[a.userId,a.userId+'@example.invalid']);await pool.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[a.organizationId]);await pool.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),a.organizationId,a.userId]);}
});
afterAll(async()=>{if(enabled){for(const a of actors){const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");for(const table of ['communication_send_gates','member'])await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[a.organizationId]);await c.query('DELETE FROM organization WHERE id=$1',[a.organizationId]);await c.query('DELETE FROM "user" WHERE id=$1',[a.userId]);await c.query('COMMIT');}finally{c.release();}}}await pool.end();});
it.runIf(enabled)('keeps concurrent actor bundles isolated on actual PostgreSQL connections',async()=>{
 const results=await Promise.all(actors.map(a=>new Store(pool,a).snapshot()));
 for(let i=0;i<actors.length;i++){expect(results[i][0]).toEqual(results[i][1]);expect(results[i][0]).toMatchObject({role:'acquire_agent_user',org:actors[i].organizationId,actor:actors[i].userId});}
 expect(results[0][0].pid).not.toBe(results[1][0].pid);
});
