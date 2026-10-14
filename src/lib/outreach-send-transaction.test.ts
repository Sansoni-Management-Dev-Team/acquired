import {afterEach,expect,it,vi} from 'vitest';
import {withOutreachSendTransaction} from './outreach-send-transaction';
afterEach(()=>vi.unstubAllEnvs());
it('holds writer role, org gate and current membership before draft changes and commits them together',async()=>{
 vi.stubEnv('COMMUNICATIONS_RUNTIME_ENABLED','true');const calls:string[]=[];const tx={execute:vi.fn(async(query:unknown)=>{const q=query as {queryChunks:unknown[]};const text=JSON.stringify(q.queryChunks);calls.push(text);return {rows:[text.includes('communications_lock_send_member')?{allowed:true}:{revision:'1'}]};})};
 const database={transaction:vi.fn(async(work:(tx:unknown)=>Promise<unknown>)=>{const result=await work(tx);calls.push('COMMIT');return result;})};
 const result=await withOutreachSendTransaction(database as never,{organizationId:'org',userId:'owner'},async(current)=>{expect(current).toBe(tx);expect(calls.join(' ')).toContain('communications_lock_send_gate');expect(calls.join(' ')).toContain('communications_lock_send_member');calls.push('WRITE');return 'saved';});
 expect(result).toBe('saved');expect(calls.at(-1)).toBe('COMMIT');expect(calls.findIndex(x=>x.includes('ROLE'))).toBeLessThan(calls.indexOf('WRITE'));
});
it('never writes outside a required transaction and propagates rollback failure boundaries',async()=>{
 vi.stubEnv('COMMUNICATIONS_RUNTIME_ENABLED','true');const work=vi.fn();await expect(withOutreachSendTransaction({} as never,{organizationId:'org',userId:'owner'},work)).rejects.toThrow();expect(work).not.toHaveBeenCalled();
 const database={transaction:vi.fn(async()=>{throw Error('transaction unavailable');})};await expect(withOutreachSendTransaction(database as never,{organizationId:'org',userId:'owner'},work)).rejects.toThrow();expect(work).not.toHaveBeenCalled();
});

it('does not enter draft policy work when the locked membership check returns false',async()=>{vi.stubEnv('COMMUNICATIONS_RUNTIME_ENABLED','true');const tx={execute:vi.fn(async(query:unknown)=>({rows:[JSON.stringify(query).includes('communications_lock_send_member')?{allowed:false}:{revision:'1'}]}))};const database={transaction:async(work:(tx:unknown)=>Promise<unknown>)=>work(tx)};const work=vi.fn();await expect(withOutreachSendTransaction(database as never,{organizationId:'org',userId:'owner'},work)).rejects.toThrow();expect(work).not.toHaveBeenCalled();});
