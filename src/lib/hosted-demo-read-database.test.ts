import{afterEach,expect,it,vi}from'vitest';
import{createHostedDemoReadSession}from'./hosted-demo-read-database';
const scope={applicationId:'acquire',tenantId:'org',ownerId:'owner'};
afterEach(()=>vi.useRealTimers());
function fixture(){
 const query=vi.fn(async(sql:string,values?:unknown[])=>{void values;return{rows:sql.includes('current_user')?[{active_role:'acquire_campaign_user',rolsuper:false,rolbypassrls:false}]:sql.includes('FROM public.member')?[{allowed:true}]:[]};}),release=vi.fn(),pool={connect:vi.fn(async()=>({query,release}))};
 return{query,release,pool,read:createHostedDemoReadSession(scope,pool as never)};
}
it('checks current scoped membership before the lookup, commits a successful read and retires the callback capability',async()=>{
 const f=fixture();let retained:(()=>Promise<unknown>)|undefined;
 expect(await f.read(async client=>{retained=()=>client.query('SELECT private');return'found';})).toBe('found');
 expect(f.query.mock.calls.map(([sql])=>sql)).toEqual(['BEGIN READ ONLY','SET LOCAL ROLE acquire_campaign_user',expect.stringContaining('current_user'),expect.stringContaining('set_config'),expect.stringContaining('FROM public.member'),'COMMIT']);
 expect(f.query.mock.calls.find(([s])=>s.includes('FROM public.member'))?.[1]).toEqual(['org','owner']);expect(f.release).toHaveBeenCalledExactlyOnceWith(undefined);
 await expect(retained!()).rejects.toThrow('Hosted read unavailable');expect(f.query).toHaveBeenCalledTimes(6);
});
it.each(['revoked','privileged','driver'])('refuses %s access before calling the lookup and discards the session without leaking its error',async kind=>{
 const f=fixture(),base=f.query.getMockImplementation()!,work=vi.fn();
 f.query.mockImplementation(async(sql,values)=>{if(kind==='driver')throw Error('PRIVATE credential');if(kind==='revoked'&&sql.includes('FROM public.member'))return{rows:[]};if(kind==='privileged'&&sql.includes('current_user'))return{rows:[{active_role:'acquire_campaign_user',rolsuper:true,rolbypassrls:false}]}as never;return base(sql,values);});
 await expect(f.read(work)).rejects.toThrow('Hosted read unavailable');expect(work).not.toHaveBeenCalled();expect(f.release).toHaveBeenCalledOnce();expect(f.release.mock.calls[0][0]).toBeInstanceOf(Error);expect(f.query.mock.calls.map(([sql])=>sql)).not.toContain('COMMIT');
});
it('bounds a stalled pool, discards a late connection exactly once and allows the next independent read',async()=>{
 vi.useFakeTimers();const f=fixture();let finish!:(value:unknown)=>void;f.pool.connect.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})as never);
 const failed=expect(f.read(async()=>'late')).rejects.toThrow('Hosted read unavailable');await vi.advanceTimersByTimeAsync(5000);await failed;
 finish({query:f.query,release:f.release});await vi.advanceTimersByTimeAsync(0);expect(f.release).toHaveBeenCalledOnce();expect(f.query).not.toHaveBeenCalled();
 expect(await f.read(async()=>'fresh')).toBe('fresh');expect(f.release).toHaveBeenCalledTimes(2);
});
it('never commits a lookup which completes after its original deadline',async()=>{
 vi.useFakeTimers();const f=fixture();let finish!:()=>void;const gate=new Promise<void>(resolve=>{finish=resolve;});
 const failed=expect(f.read(async()=>{await gate;return'late';})).rejects.toThrow('Hosted read unavailable');await vi.advanceTimersByTimeAsync(5000);await failed;finish();await vi.advanceTimersByTimeAsync(0);
 expect(f.query.mock.calls.map(([sql])=>sql)).not.toContain('COMMIT');expect(f.release).toHaveBeenCalledOnce();
});
it('permits an explicitly bounded ten-second authority read aggregate without changing SQL limits',async()=>{
 vi.useFakeTimers();const f=fixture(),original=f.query.getMockImplementation()!;f.query.mockImplementation(async(sql,args)=>{await new Promise(r=>setTimeout(r,1000));return original(sql,args);});
 const read=createHostedDemoReadSession(scope,f.pool as never,{timeoutMs:10000});const result=read(async tx=>{await tx.query('SELECT synthetic');return'ok';});await vi.advanceTimersByTimeAsync(7000);expect(await result).toBe('ok');expect(f.query.mock.calls.some(([sql])=>sql.includes("'statement_timeout','5000ms'")&&sql.includes("'lock_timeout','1000ms'"))).toBe(true);
});
it('retires a ten-second authority read at its absolute deadline',async()=>{
 vi.useFakeTimers();const f=fixture(),read=createHostedDemoReadSession(scope,f.pool as never,{timeoutMs:10000});const result=expect(read(async()=>new Promise(()=>{}))).rejects.toThrow();await vi.advanceTimersByTimeAsync(10001);await result;expect(f.release).toHaveBeenLastCalledWith(expect.any(Error));expect(f.query.mock.calls.some(([sql])=>sql==='COMMIT')).toBe(false);
});
