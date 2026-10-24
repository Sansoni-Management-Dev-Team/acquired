import{expect,it}from'vitest';
import{localHistoryTurn}from'./local-history-turn';
import type{SqlPool}from'./webhook-repository';
const scope={applicationId:'acquire',tenantId:'tenant',ownerId:'owner'};
function fixture(){const held=new Set<string>();let releases=0;const pool={async connect(){let owned:string|undefined;return{async query(sql:string,args:unknown[]=[]){const key=String(args[0]);if(sql.includes('pg_try_advisory_lock')){const acquired=!held.has(key);if(acquired){held.add(key);owned=key;}return{rows:[{acquired}]};}if(sql.includes('pg_advisory_unlock')){held.delete(key);owned=undefined;return{rows:[{released:true}]};}throw Error('unexpected SQL');},release(){if(owned)held.delete(owned);releases++;}};}} as SqlPool;return{pool,held,releases:()=>releases};}
it('independent hosts sharing one database cannot overlap tenant history work',async()=>{
 const f=fixture();let active=0,peak=0;
 const job=()=>localHistoryTurn(f.pool,scope,async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,10));active--;});
 await Promise.all([job(),job(),job()]);expect(peak).toBe(1);expect(f.held.size).toBe(0);expect(f.releases()).toBeGreaterThanOrEqual(3);
});
it('nested scan stays inside the outer read/project turn and throws release ownership',async()=>{
 const f=fixture();await expect(localHistoryTurn(f.pool,scope,()=>localHistoryTurn(f.pool,scope,async()=>{expect(f.held.size).toBe(1);throw Error('source failed');}))).rejects.toThrow('source failed');expect(f.held.size).toBe(0);
});
it('aborted callers never execute protected work',async()=>{
 const f=fixture(),c=new AbortController();c.abort();let ran=false;
 await expect(localHistoryTurn(f.pool,scope,async()=>{ran=true;},c.signal)).rejects.toThrow();expect(ran).toBe(false);
});
