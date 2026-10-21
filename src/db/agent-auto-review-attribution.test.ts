import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {AgentStore,type AgentThread} from './agent-store';
const id='10000000-0000-4000-8000-000000000001',thread:AgentThread={id,organization_id:'org',owner_user_id:'owner',mandate_id:id,revision:1};
const manifest=[{operationId:id,revision:1,digest:'a'.repeat(64),contextRevision:'b'.repeat(64)}];
function fixture(mode='demo'){
 const query=vi.fn(async(sql:string)=>({rows:sql.includes('SELECT mode')?[{mode}]:sql.includes('SELECT * FROM agent_review_batches')?[{id,revision:1,state:'pending',manifest}]:sql.includes('UPDATE agent_review_batches')?[{id,state:'approved'}]:[],rowCount:1})),client={query} as unknown as PoolClient;
 class Harness extends AgentStore{protected override async transaction<T>(work:(c:PoolClient)=>Promise<T>){return work(client);}protected override async lockThread(){return thread;}protected override async currentReviewOperations(){return [];}}
 return{query,store:new Harness({} as Pick<Pool,'connect'>,{organizationId:'org',userId:'owner'})};
}
it('saves automatic approval as an assistant activity with the exact original manifest',async()=>{
 const f=fixture();await f.store.decideReviewBatch(id,id,1,manifest,'approved','automatic_demo');
 const insert=f.query.mock.calls.find(([sql])=>sql.includes('INSERT INTO agent_messages'))! as unknown as [string,unknown[]];
 expect(insert[1][5]).toBe('assistant');expect(JSON.parse(String(insert[1][6]))).toMatchObject({approvalSource:'automatic_demo',items:manifest,text:expect.stringContaining('Automatically approved')});
});
it('rejects automatic attribution for real mandates before changing any review',async()=>{
 const f=fixture('real');await expect(f.store.decideReviewBatch(id,id,1,manifest,'approved','automatic_demo')).rejects.toThrow('approved demo');expect(f.query.mock.calls.some(([sql])=>/^UPDATE|INSERT/.test(sql))).toBe(false);
});
it('keeps human approval attribution and exact-manifest validation',async()=>{
 const f=fixture();await f.store.decideReviewBatch(id,id,1,manifest,'approved');const insert=f.query.mock.calls.find(([sql])=>sql.includes('INSERT INTO agent_messages'))! as unknown as [string,unknown[]];expect(insert[1][5]).toBe('user');expect(JSON.parse(String(insert[1][6]))).not.toHaveProperty('approvalSource');
 await expect(f.store.decideReviewBatch(id,id,1,[{...manifest[0],revision:2}],'approved','automatic_demo')).rejects.toThrow();
});
