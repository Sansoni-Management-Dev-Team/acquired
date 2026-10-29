import {afterEach,expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {AgentExecutionStore} from './agent-execution-store';

vi.mock('server-only',()=>({}));
afterEach(()=>vi.restoreAllMocks());

const thread={id:'11111111-1111-4111-8111-111111111111',mandate_id:'mandate',organization_id:'organization'};
function fixture(responsibility?:Record<string,unknown>){
 const store=new AgentExecutionStore({}as never,{organizationId:thread.organization_id,userId:'owner'});
 const query=vi.fn(async(sql:string)=>({rows:sql.startsWith('SELECT xmin')?[{revision:'42',execution_mode:'real'}]:sql.startsWith('SELECT * FROM agent_responsibilities')&&responsibility?[responsibility]:[]}));
 const internal=store as unknown as{nativeTransaction:<T>(work:(c:PoolClient)=>Promise<T>)=>Promise<T>;thread:()=>Promise<unknown>};
 vi.spyOn(internal,'nativeTransaction').mockImplementation(work=>work({query}as unknown as PoolClient));
 vi.spyOn(internal,'thread').mockResolvedValue(thread);
 return{store,query};
}

it('serializes an existing thread without supervision as an explicit null responsibility',async()=>{
 const f=fixture();
 const body=await Response.json({state:await f.store.executionState(thread.id)}).json();
 expect(body.state).toHaveProperty('responsibility',null);
 expect(body.state).toMatchObject({mandateRevision:'42',executionMode:'real',conversations:[]});
 expect(f.query.mock.calls.every(([sql])=>sql.startsWith('SELECT'))).toBe(true);
});

it('preserves the saved supervision revision and state in the serialized projection',async()=>{
 const responsibility={id:'responsibility',revision:3,state:'paused',mandate_revision:'42'};
 const f=fixture(responsibility);
 const body=await Response.json({state:await f.store.executionState(thread.id)}).json();
 expect(body.state.responsibility).toEqual(responsibility);
});
