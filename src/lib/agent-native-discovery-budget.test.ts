import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const m=vi.hoisted(()=>({query:vi.fn(),release:vi.fn(),connect:vi.fn()}));
vi.mock('./agent-runtime',()=>({agentPool:()=>({connect:m.connect}),agentStore:vi.fn(),nativeAgentEnabled:()=>true}));
import {listDueNativeAgentScopes,listRegisteredNativeAgentScopes,listRegisteredReviewRecoveryScopes} from './agent-native-tick';
const runtime='acquire-hosted-demo-v1';
beforeEach(()=>{
 vi.resetAllMocks();m.connect.mockResolvedValue({query:m.query,release:m.release});
 m.query.mockImplementation(async(raw:string|{text:string})=>{
  const sql=typeof raw==='string'?raw:raw.text;
  if(sql.includes('SELECT current_user'))return{rows:[{name:'acquire_agent_worker',rolsuper:false,rolbypassrls:false}]};
  if(sql.includes('to_regprocedure'))return{rows:[{installed:true}]};
  return{rows:[]};
 });
});
const statements=()=>m.query.mock.calls.map(([raw])=>typeof raw==='string'?raw:raw.text);
it.each([
 ['legacy',()=>listDueNativeAgentScopes(10)],
 ['registered',()=>listRegisteredNativeAgentScopes(10,runtime)],
 ['review recovery',()=>listRegisteredReviewRecoveryScopes(10,runtime)],
] as const)('bounds %s discovery in PostgreSQL before enumerating scopes',async(_name,run)=>{
 expect(await run()).toEqual([]);
 const sql=statements(),budget=sql.findIndex(value=>value.includes("set_config('statement_timeout'"));
 expect(budget).toBeGreaterThan(sql.indexOf('BEGIN'));
 expect(budget).toBeLessThan(sql.indexOf('SET LOCAL ROLE acquire_agent_worker'));
 expect(sql[budget]).toContain("set_config('lock_timeout'");
 expect(m.query.mock.calls[budget][0]).toMatchObject({values:['5000ms','1000ms']});
 for(const [raw] of m.query.mock.calls)expect(raw).toMatchObject({query_timeout:6500});
 expect(sql).toContain('COMMIT');expect(m.release).toHaveBeenCalledExactlyOnceWith();
});
it('rolls back a server-cancelled enumeration without returning fabricated scopes',async()=>{
 const original=m.query.getMockImplementation()!;const error=Object.assign(Error('cancelled enumeration'),{code:'57014'});
 m.query.mockImplementation(async(raw,...args)=>{
  if((typeof raw==='string'?raw:raw.text).includes('SELECT * FROM agent_registered_worker_scopes'))throw error;
  return original(raw,...args);
 });
 await expect(listRegisteredNativeAgentScopes(10,runtime)).rejects.toBe(error);
 expect(statements()).toContain('ROLLBACK');expect(statements()).not.toContain('COMMIT');expect(m.release).toHaveBeenCalledExactlyOnceWith();
});
it('discards a connection when rollback cannot confirm the end of its restricted transaction',async()=>{
 const original=m.query.getMockImplementation()!,error=Error('connection lost');
 m.query.mockImplementation(async(raw,...args)=>{
  const sql=typeof raw==='string'?raw:raw.text;
  if(sql.includes('SELECT * FROM agent_registered_worker_scopes')||sql==='ROLLBACK')throw error;
  return original(raw,...args);
 });
 await expect(listRegisteredNativeAgentScopes(10,runtime)).rejects.toBe(error);
 expect(m.release).toHaveBeenCalledExactlyOnceWith(error);
});
