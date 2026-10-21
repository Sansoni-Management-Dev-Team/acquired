import {installAgentReadBudget,withAgentReadBudget} from './agent-read-budget';
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {AgentPeopleStore} from './agent-people-store';
vi.mock('server-only',()=>({}));
const thread='00000000-0000-4000-8000-000000000001';
function fixture(timeout=false){
 let statement=0,lock=0,rolledBack=false;const trace:string[]=[];
 const query=vi.fn(async(text:string,args?:unknown[])=>{trace.push(text);
  if(text==='ROLLBACK'){rolledBack=true;return{rows:[]};}
  if(text.includes('pg_settings'))return{rows:[{statement_ms:statement,lock_ms:lock}]};
  if(text.includes("set_config('statement_timeout'")){statement=Number(args?.[0]);lock=Number(args?.[1]);return{rows:[]};}
  if(text.includes('rolbypassrls'))return{rows:[{name:'acquire_agent_user',rolsuper:false,rolbypassrls:false}]};
  if(text.includes('to_regprocedure'))return{rows:[{installed:true}]};
  if(text.includes('agent_lock_send_gate')){expect(statement).toBeGreaterThan(0);expect(statement).toBeLessThanOrEqual(3000);expect(lock).toBeGreaterThan(0);expect(lock).toBeLessThanOrEqual(1000);return{rows:[]};}
  if(text.includes('agent_lock_member'))return{rows:[{allowed:true}]};
  if(text.includes('FROM agent_threads'))return{rows:[{id:thread,organization_id:'org',owner_user_id:'actor',mandate_id:thread,revision:1}]};
  if(text.includes('agent_people_company_snapshot')){if(timeout)throw Object.assign(Error('synthetic statement timeout'),{code:'57014'});return{rows:[{snapshot:{companies:[]}}]};}
  if(text.includes('agent_approved_guidance'))return{rows:[{items:[]}]};
  return{rows:[]};
 });const release=vi.fn(),pool={connect:async()=>({query,release} as unknown as PoolClient)};return{store:new AgentPeopleStore(pool,{organizationId:'org',userId:'actor'}),trace,query,release,get rolledBack(){return rolledBack;}};
}
it('bounds readiness before taking the shared gate instead of allowing an unbounded protected read',async()=>{const f=fixture();await f.store.peopleResearchContext(thread);expect(f.trace.findIndex(s=>s.includes("set_config('statement_timeout'"))).toBeLessThan(f.trace.findIndex(s=>s.includes('agent_lock_send_gate')));});
it('rolls back a timed out snapshot and exposes unavailability rather than returning empty eligible companies',async()=>{const f=fixture(true);await expect(f.store.peopleResearchContext(thread)).rejects.toMatchObject({name:'AgentReadinessUnavailableError'});expect(f.rolledBack).toBe(true);expect(f.trace).not.toContain('COMMIT');expect(f.release).toHaveBeenCalledOnce();});

it.each([[5000,2000,3000,1000],[500,100,500,100]])('restores prior successful transaction settings and never loosens stricter limits (%i/%i)',async(statement,lock,limitedStatement,limitedLock)=>{let current={statement,lock};const query=vi.fn(async(text:string,args?:unknown[])=>{if(text.includes('pg_settings'))return{rows:[{statement_ms:current.statement,lock_ms:current.lock}]};if(text.includes("set_config('statement_timeout'"))current={statement:Number(args?.[0]),lock:Number(args?.[1])};return{rows:[]};});const c={query}as unknown as PoolClient;await withAgentReadBudget(c,async()=>{expect(current).toEqual({statement:limitedStatement,lock:limitedLock});return'original result';});expect(current).toEqual({statement,lock});});
it('rejects an invalid internal preset before changing database settings',async()=>{const query=vi.fn();await expect(installAgentReadBudget({query}as unknown as PoolClient,'caller-defined'as never)).rejects.toThrow('Unknown protected agent transaction preset');expect(query).not.toHaveBeenCalled();});
