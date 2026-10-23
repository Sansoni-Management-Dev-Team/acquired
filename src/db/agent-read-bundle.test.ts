import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {AgentStore} from './agent-store';
vi.mock('server-only',()=>({}));
class Store extends AgentStore{
 read(){return this.transaction(c=>c.query('SELECT fixture'));}
 bundle(work:()=>Promise<unknown>){return this.readBundle(work);}
}
function fixture(){const query=vi.fn(async(text:string)=>({rows:text.includes('current_user')?[{name:'acquire_agent_user',rolsuper:false,rolbypassrls:false}]:text.includes('to_regprocedure')?[{installed:true}]:text.includes('agent_lock_member')?[{allowed:true}]:[]}));const release=vi.fn(),connect=vi.fn(async()=>({query,release})as unknown as PoolClient);return{query,release,connect,store:new Store({connect}as unknown as Pool,{organizationId:'org',userId:'user'})};}
it('takes the role and ownership gate once for a bounded read bundle',async()=>{const f=fixture();await f.store.bundle(async()=>{await f.store.read();await f.store.read();});expect(f.connect).toHaveBeenCalledTimes(1);expect(f.query.mock.calls.filter(([q])=>q==='SELECT public.agent_lock_send_gate()')).toHaveLength(1);expect(f.query.mock.calls.filter(([q])=>q==='SELECT fixture')).toHaveLength(2);expect(f.release).toHaveBeenCalledOnce();});
it('rolls back the entire bundle and does not leak its client into later requests',async()=>{const f=fixture();await expect(f.store.bundle(async()=>{await f.store.read();throw Error('failed read');})).rejects.toThrow('failed read');expect(f.query).toHaveBeenCalledWith('ROLLBACK');await f.store.read();expect(f.connect).toHaveBeenCalledTimes(2);});
it('does not reuse another actor store connection in the same async call chain',async()=>{const a=fixture(),b=fixture();await a.store.bundle(async()=>{await a.store.read();await b.store.read();});expect(a.connect).toHaveBeenCalledOnce();expect(b.connect).toHaveBeenCalledOnce();});
it('does not let late async work reuse a committed bundle client',async()=>{
 const f=fixture();let late!:()=>Promise<unknown>;let resolve!:(value:unknown)=>void;
 const pending=new Promise(done=>{resolve=done;});
 await f.store.bundle(async()=>{late=()=>pending.then(()=>f.store.read());lateResult=late().catch(error=>error);});
 resolve(null);expect(await lateResult).toBeInstanceOf(Error);expect(f.query.mock.calls.filter(([q])=>q==='SELECT fixture')).toHaveLength(0);
});
let lateResult:Promise<unknown>;
