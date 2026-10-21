import {afterAll,describe,it,expect} from 'vitest';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {loadMandateResearchContext} from '@/lib/mandate-execution-context';
import {vi} from 'vitest';vi.mock('server-only',()=>({}));
const enabled=process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
afterAll(()=>pool.end());
describe.runIf(enabled)('shared mandate context0070 (unregistered rollback-only, no effects)',()=>{
 it('loads real research for demo with no contacts, mappings, policy or accounts under actual restricted role',async()=>{const c=await pool.connect(),org=randomUUID(),user=randomUUID(),mandate=randomUUID();try{
  expect((await c.query("SELECT current_database() name,shobj_description(oid,'pg_database') marker FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
  await c.query('BEGIN');await c.query('INSERT INTO public."user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);await c.query('INSERT INTO public.organization(id,name,slug) VALUES($1,$1,$1)',[org]);await c.query("INSERT INTO public.member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);await c.query("INSERT INTO public.mandates(id,organization_id,created_by,natural_language,filters,provenance) VALUES($1,$2,$3,'Synthetic shared context fixture','{}','{}')",[mandate,org,user]);await c.query("INSERT INTO public.agent_mandate_execution_modes(mandate_id,organization_id,created_by,mode,demo_id) VALUES($1,$2,$3,'demo',$1)",[mandate,org,user]);await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[org,user]);await c.query('SET LOCAL ROLE acquire_agent_user');
  expect(await loadMandateResearchContext(c,{actor:{organizationId:org,userId:user},mandateId:mandate})).toEqual({version:1,mandateId:mandate,mode:'demo',identityScope:{kind:'demo',id:mandate}});
 }finally{await c.query('ROLLBACK');c.release();}});
});
