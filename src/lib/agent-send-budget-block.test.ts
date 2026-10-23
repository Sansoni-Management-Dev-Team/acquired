import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {AgentOutreachStore} from '@/db/agent-outreach-store';
import type {AgentModelStore} from '@/db/agent-model-store';
import type {AgentThread} from '@/db/agent-store';
import {createNativeAgentHandlers} from './agent-native-handlers';
import {plainAgentStatusText} from './agent-chat-status-copy';
vi.mock('server-only',()=>({}));
const id='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',context='a'.repeat(64);
const thread:AgentThread={id,organization_id:'synthetic-org',owner_user_id:'synthetic-owner',mandate_id:id,revision:1};
const copy='A shared sending limit has been reached or needs renewing. This message was not sent. Check sending limits before continuing.';
function reservationFailure(cause:unknown=Object.assign(Error('Shared budget exhausted or expired'),{code:'P0001'})){
 const query=vi.fn(async(sql:string)=>{
  if(sql.startsWith('SELECT agent_reserve_budget'))throw cause;
  return {rows:sql.startsWith('SELECT id FROM agent_review_batches')?[{id}]:sql.startsWith('UPDATE agent_operations')?[{id,fence:'1'}]:sql.startsWith('SELECT DISTINCT ON(scope_key)')?Array.from({length:4},()=>({id})):[],rowCount:1};
 });
 const client={query}as unknown as PoolClient;
 class Harness extends AgentOutreachStore{
  protected override async lockConversation(){return {id,context_revision:context};}
  attempt(){return this.prepareNativeEmailAuthority(client,thread,{id,state:'approved',conversation_id:id,input:{contextRevision:context},revision:1,input_digest:context},undefined,{bindingDigest:context});}
 }
 return {query,store:new Harness({connect:vi.fn()}as never,{organizationId:thread.organization_id,userId:thread.owner_user_id})};
}
async function blockedError(){try{await reservationFailure().store.attempt();throw Error('Expected reservation refusal');}catch(error){return error;}}
function handlers(error:unknown,kind='review.approved',scope=id,partial=false){
 const dispatch=vi.fn().mockRejectedValue(error),hold=vi.fn(),local=vi.fn();
 const store={reviewDispatchTargets:vi.fn(async()=>[...(partial?[{id:other,name:'email.initial',delivery_mode:'local_sink',conversationId:other}]:[]),{id,name:'email.initial',delivery_mode:'communications',conversationId:scope}]),delegatedDispatchTarget:vi.fn(async()=>({id,conversationId:scope,deliveryMode:'communications',grant:{id,revision:1}})),holdNativeConversation:hold,deliverApprovedLocalEmail:local};
 const h=createNativeAgentHandlers({store:store as unknown as AgentModelStore,dispatchProvider:dispatch});
 const input={event:{id,thread_id:id,kind,payload:kind==='review.approved'?{reviewBatchId:id}:{operationId:id},lease_owner:id,fence:'1',attempts:1},runId:id,signal:new AbortController().signal,assertCurrent:vi.fn(async()=>{})};
 return {run:()=>h[kind](input),dispatch,hold,local};
}
it('classifies only the exact budget-kernel refusal at the pre-submit reservation boundary',async()=>{
 const f=reservationFailure();await expect(f.store.attempt()).rejects.toMatchObject({name:'AgentPreBeginSendBudgetError',threadId:id,conversationId:id,operationId:id,message:copy});
 expect(f.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO agent_authority_uses'))).toBe(false);
 for(const cause of [Object.assign(Error('Shared budget exhausted or expired'),{code:'40001'}),Object.assign(Error('Private SQL failure'),{code:'P0001'}),Error('Shared budget exhausted or expired')])await expect(reservationFailure(cause).store.attempt()).rejects.toBe(cause);
});
it('reports a known unsent budget block without retrying, holding, or fabricating a provider outcome',async()=>{
 const error=await blockedError();for(const kind of ['review.approved','email.proposed','whatsapp.proposed','linkedin.proposed']){const f=handlers(error,kind);await expect(f.run()).resolves.toEqual({kind:'review',message:copy});expect(f.dispatch).toHaveBeenCalledOnce();expect(f.hold).not.toHaveBeenCalled();}
 const saved={role:'assistant',request_key:'event-review:'+id+':1',lead_name:'Synthetic Lead',content:{text:copy,triggerEventId:id,runId:other}};
 expect(plainAgentStatusText(saved)).toBe('Synthetic Lead: '+copy);expect(saved.content.text).toBe(copy);
});
it('does not claim a whole batch was unsent after another effect or trust a foreign/opaque error',async()=>{
 const error=await blockedError();for(const f of [handlers(error,'review.approved',other),handlers(error,'review.approved',id,true),handlers(Object.assign(Error(copy),{name:'AgentPreBeginSendBudgetError',threadId:id,conversationId:id,operationId:id}))])await expect(f.run()).rejects.toBeDefined();
});
