import type {PoolClient} from 'pg';
import {afterEach,expect,it,vi} from 'vitest';
import {backgroundPool} from './background-pool';
import {BackgroundAdmission,withBackgroundBudget} from '@/lib/background-workload';
const fixture=()=>{const query=vi.fn(async(arg:unknown)=>{void arg;return{rows:[{ok:1}]};}),release=vi.fn(),connect=vi.fn(async()=>({query,release}));const physical={query,connect};return{query,release,connect,pool:backgroundPool(physical as never,new BackgroundAdmission())};};
const text=(arg:unknown)=>typeof arg==='string'?arg:(arg as {text:string}).text;
afterEach(()=>vi.useRealTimers());
it('leaves interactive queries untouched',async()=>{const f=fixture();await f.pool.query('SELECT 1');expect(f.connect).not.toHaveBeenCalled();expect(f.query).toHaveBeenCalledExactlyOnceWith('SELECT 1');});
it('sets server budgets on the same client and commits before releasing',async()=>{
 const f=fixture();await withBackgroundBudget('test',10000,()=>f.pool.query('SELECT 1'));
 const sql=f.query.mock.calls.map(([arg])=>text(arg));expect(sql[0]).toBe('BEGIN');expect(sql.at(-1)).toBe('COMMIT');
 expect(sql.findIndex(s=>s.includes('statement_timeout'))).toBeLessThan(sql.indexOf('SELECT 1'));expect(f.release).toHaveBeenCalledExactlyOnceWith();
});
it('rolls back server cancellation and allows reuse only after confirmation',async()=>{
 const f=fixture(),original=f.query.getMockImplementation()!;f.query.mockImplementation(async arg=>{if(text(arg)==='SELECT slow')throw Object.assign(Error('cancelled'),{code:'57014'});return original(arg);});
 await expect(withBackgroundBudget('test',10000,()=>f.pool.query('SELECT slow'))).rejects.toMatchObject({code:'57014'});
 expect(f.query.mock.calls.map(([arg])=>text(arg))).toContain('ROLLBACK');expect(f.release).toHaveBeenCalledExactlyOnceWith();
});
it('retires an ambiguous stream rather than enqueueing rollback on it',async()=>{
 const f=fixture();f.query.mockRejectedValueOnce(Error('Query read timeout'));
 await expect(withBackgroundBudget('test',10000,()=>f.pool.query('SELECT 1'))).rejects.toThrow();expect(f.release).toHaveBeenCalledExactlyOnceWith(expect.any(Error));expect(f.query).toHaveBeenCalledTimes(1);
});
it('releases a late checkout after the caller has timed out',async()=>{
 vi.useFakeTimers();const f=fixture();let finish!:(value:unknown)=>void;f.connect.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve as never;}));
 const result=expect(withBackgroundBudget('test',10000,()=>f.pool.query('SELECT 1'))).rejects.toThrow();
 await vi.advanceTimersByTimeAsync(2001);await result;finish({query:f.query,release:f.release});await vi.advanceTimersByTimeAsync(1);
 expect(f.release).toHaveBeenCalledExactlyOnceWith(expect.any(Error));expect(f.query).not.toHaveBeenCalled();
});
it('retires a stalled transaction at the total deadline, with no later SQL',async()=>{
 vi.useFakeTimers();const f=fixture();let client:PoolClient;
 await withBackgroundBudget('test',50,async()=>{client=await f.pool.connect();await client.query('BEGIN');await vi.advanceTimersByTimeAsync(51);await expect(client.query('SELECT 1')).rejects.toThrow();client.release();});
 expect(f.release).toHaveBeenCalledExactlyOnceWith(expect.any(Error));expect(f.query.mock.calls.some(([arg])=>text(arg)==='SELECT 1')).toBe(false);
});
it('preserves query configs and callback callers',async()=>{
 const f=fixture();await withBackgroundBudget('test',10000,()=>new Promise<void>((resolve,reject)=>f.pool.query({text:'SELECT 1',rowMode:'array'},(error)=>error?reject(error):resolve())));
 expect(f.query.mock.calls.find(([arg])=>text(arg)==='SELECT 1')?.[0]).toMatchObject({rowMode:'array',query_timeout:expect.any(Number)});
});

it('discards a server-cancelled connection when rollback also fails',async()=>{
 const f=fixture(),original=f.query.getMockImplementation()!;
 f.query.mockImplementation(async arg=>{if(text(arg)==='SELECT slow')throw Object.assign(Error('cancelled'),{code:'57014'});if(text(arg)==='ROLLBACK')throw Error('lost rollback');return original(arg);});
 await expect(withBackgroundBudget('test',10000,()=>f.pool.query('SELECT slow'))).rejects.toMatchObject({code:'57014'});
 expect(f.release).toHaveBeenCalledExactlyOnceWith(expect.any(Error));
});
it('shares admission across different pools while interactive work continues',async()=>{
 const gate=new BackgroundAdmission(),one=fixture(),two=fixture();
 const a=backgroundPool({connect:one.connect,query:one.query} as never,gate),b=backgroundPool({connect:two.connect,query:two.query} as never,gate);
 let finish!:()=>void;
 const first=withBackgroundBudget('one',10000,async()=>{const client=await a.connect();await new Promise<void>(resolve=>{finish=resolve;});client.release();});
 await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
 const second=withBackgroundBudget('two',10000,()=>b.query('SELECT 2'));await Promise.resolve();expect(two.connect).not.toHaveBeenCalled();
 await b.query('SELECT interactive');expect(two.query).toHaveBeenCalledWith('SELECT interactive');finish();await first;await second;
});
it('reserves background capacity without sending interactive work to that pool',async()=>{
 const interactive={connect:vi.fn(async()=>{throw Error('interactive pool occupied');}),query:vi.fn(async()=>({rows:[{lane:'interactive'}]}))};
 const reservedQuery=vi.fn(async()=>({rows:[{lane:'reserved'}]})),reserved={connect:vi.fn(async()=>({query:reservedQuery,release:vi.fn()}))};
 const pool=backgroundPool(interactive as never,new BackgroundAdmission(),reserved as never);
 expect((await withBackgroundBudget('reserved',10000,()=>pool.query('SELECT 1'))).rows).toEqual([{lane:'reserved'}]);
 expect(interactive.connect).not.toHaveBeenCalled();expect(reserved.connect).toHaveBeenCalledOnce();
 expect((await pool.query('SELECT 1')).rows).toEqual([{lane:'interactive'}]);expect(reserved.connect).toHaveBeenCalledOnce();
});
it('completes bounded sequential work at 132ms RTT without redundant timeout-setting round trips',async()=>{
 let elapsed=0;const clock=vi.spyOn(performance,'now').mockImplementation(()=>elapsed);const f=fixture();
 f.query.mockImplementation(async arg=>{const config=arg as {text:string;query_timeout:number};expect(config.query_timeout).toBeLessThanOrEqual(8000-elapsed);elapsed+=132;return{rows:[{ok:1}]};});
 try{await withBackgroundBudget('latency',8000,async()=>{const c=await f.pool.connect();try{await c.query('BEGIN');for(let i=0;i<50;i++)await c.query('SELECT 1');await c.query('COMMIT');}finally{c.release();}});
 expect(f.query.mock.calls.filter(([arg])=>text(arg).includes("set_config('statement_timeout'"))).toHaveLength(1);expect(elapsed).toBe(6996);expect(f.release).toHaveBeenCalledExactlyOnceWith();
 }finally{clock.mockRestore();}
});
it('restores server limits immediately after a caller attempts to override them',async()=>{
 const f=fixture();await withBackgroundBudget('override',10000,async()=>{const c=await f.pool.connect();try{await c.query('BEGIN');await c.query("SET statement_timeout='120s'");await c.query('SELECT 1');await c.query('COMMIT');}finally{c.release();}});
 const calls=f.query.mock.calls.map(([arg])=>arg as {text:string;values?:unknown[]});const index=calls.findIndex(c=>c.text.startsWith('SET statement_timeout'));
 expect(calls[index+1].text).toContain("set_config('statement_timeout'");expect(parseInt(String(calls[index+1].values?.[0]))).toBeLessThanOrEqual(3000);
});
it('retires an in-flight query at the absolute deadline and prevents a later commit',async()=>{
 vi.useFakeTimers();const f=fixture(),original=f.query.getMockImplementation()!;
 f.query.mockImplementation(arg=>text(arg)==='SELECT hanging'?new Promise(()=>{}):original(arg));
 await withBackgroundBudget('in-flight',50,async()=>{const c=await f.pool.connect();await c.query('BEGIN');const pending=expect(c.query('SELECT hanging')).rejects.toThrow();await vi.advanceTimersByTimeAsync(51);await pending;await expect(c.query('COMMIT')).rejects.toThrow();c.release();});
 expect(f.release).toHaveBeenCalledExactlyOnceWith(expect.any(Error));expect(f.query.mock.calls.some(([arg])=>text(arg)==='COMMIT')).toBe(false);
});
it('reports the allowlisted admission reason without logging private error data',async()=>{
 vi.useFakeTimers();const log=vi.spyOn(console,'info').mockImplementation(()=>{});const gate=new BackgroundAdmission();const f=fixture();const pool=backgroundPool({connect:f.connect,query:f.query} as never,gate);
 const release=await gate.acquire();
 try{const pending=expect(withBackgroundBudget('research.scheduled',10000,()=>pool.query('SELECT private_payload'))).rejects.toMatchObject({reason:'busy'});await vi.advanceTimersByTimeAsync(1001);await pending;
 const entries=log.mock.calls.filter(c=>c[0]==='background-database').map(c=>JSON.parse(c[1]));expect(entries).toContainEqual(expect.objectContaining({stage:'admission',outcome:'deferred',reason:'busy'}));expect(JSON.stringify(entries)).not.toContain('private_payload');expect(f.connect).not.toHaveBeenCalled();
 }finally{release();log.mockRestore();}
});
