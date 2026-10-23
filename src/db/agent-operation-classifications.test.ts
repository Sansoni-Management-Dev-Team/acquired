import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {AgentStore,type AgentThread} from './agent-store';
import {AgentOutreachStore} from './agent-outreach-store';
import {AgentInvitationStore} from './agent-invitation-store';
import {AgentExecutionStore} from './agent-execution-store';
import {isAgentMessageReview} from '@/components/agent-review-cards';
import {createNativeAgentHandlers} from '@/lib/agent-native-handlers';
import type {AgentModelStore} from './agent-model-store';
vi.mock('server-only',()=>({}));

const id='10000000-0000-4000-8000-000000000001',digest='a'.repeat(64),contextRevision='b'.repeat(64);
const thread:AgentThread={id,organization_id:'org',owner_user_id:'user',mandate_id:id,revision:1};
const messages=['email.initial','email.reply','email.follow_up','whatsapp.initial','whatsapp.reply','whatsapp.follow_up','linkedin.initial','linkedin.reply','linkedin.follow_up'];
const reviewable=['target.select','research.start','research.people','research.fields','sequence.prepare','sequence.publish','sequence.enrol',...messages,'linkedin.invitation','email.manual_link'];
const unsupported=['','email','Email.reply','email.reply.extra','email.initial\n','email.reconcile','whatsapp.manual_link','linkedin.manual_link','linkedin.accept','human.handoff'];

class ReviewHarness extends AgentStore{
 check(name:string,changed=false){
  const query=vi.fn().mockResolvedValue({rows:[{id,name,state:'proposed',revision:1,input_digest:digest,input:{contextRevision:changed?'changed':contextRevision}}]});
  return this.currentReviewOperations({query} as unknown as PoolClient,thread,[{operationId:id,revision:1,digest,contextRevision}]);
 }
}
it('admits only the existing review families and preserves exact saved-context checking',async()=>{
 const store=new ReviewHarness({} as Pick<Pool,'connect'>,{organizationId:'org',userId:'user'});
 for(const name of reviewable){expect(await store.check(name)).toHaveLength(1);await expect(store.check(name,true)).rejects.toThrow('Operation changed');}
 for(const name of unsupported)await expect(store.check(name)).rejects.toThrow('not reviewable');
});

it('keeps presentation-only social manual links separate from server review admission',()=>{
 for(const name of [...messages,'linkedin.invitation','email.manual_link','whatsapp.manual_link','linkedin.manual_link'])expect(isAgentMessageReview(name),name).toBe(true);
 for(const name of ['target.select','research.start','email','email.manual_link.extra','email.invitation','LinkedIn.reply','email.initial\n','linkedin.accept'])expect(isAgentMessageReview(name),name).toBe(false);
});

it('dispatches reviewed messages and invitations only through their recorded communications adapter',async()=>{
 for(const name of [...messages,'linkedin.invitation',...unsupported,'email.manual_link']){
  const dispatchProvider=vi.fn(),deliverApprovedLocalEmail=vi.fn(),store={reviewDispatchTargets:vi.fn().mockResolvedValue([{id,name,delivery_mode:'communications'}]),deliverApprovedLocalEmail};
  const handlers=createNativeAgentHandlers({store:store as unknown as AgentModelStore,dispatchProvider});
  const result=await handlers['review.approved']({event:{id,thread_id:id,kind:'review.approved',payload:{reviewBatchId:id},lease_owner:id,fence:'1',attempts:1},runId:id,signal:new AbortController().signal,assertCurrent:vi.fn()});
  const accepted=messages.includes(name)||name==='linkedin.invitation';expect(result.kind,name).toBe(accepted?'complete':'review');expect(dispatchProvider.mock.calls.length,name).toBe(accepted?1:0);expect(deliverApprovedLocalEmail).not.toHaveBeenCalled();
 }
});

function pendingQuery(prototype:object){
 const query=vi.fn().mockResolvedValue({rows:[],rowCount:0});
 const store=Object.assign(Object.create(prototype),{nativeTransaction:(work:(client:unknown)=>unknown)=>work({query}),thread:async()=>thread,lockConversation:async()=>({id})}) as AgentOutreachStore;
 return{query,store};
}
function operationNames(sql:string){return [...sql.matchAll(/(?:o\.)?name IN\(([^)]+)\)/g)].flatMap(match=>[...match[1].matchAll(/'([^']+)'/g)].map(value=>value[1]));}
it('keeps pending ordinary messages distinct from invitation-aware pending work with the same saved review barrier',async()=>{
 for(const [prototype,names]of [[AgentOutreachStore.prototype,messages],[AgentInvitationStore.prototype,[...messages,'linkedin.invitation']]] as const){
  const {query,store}=pendingQuery(prototype);expect(await store.pendingNativeEmail(id,id,contextRevision)).toBe(false);
  const [sql,values]=query.mock.calls[0];expect(operationNames(sql)).toEqual(names);expect(values).toEqual([id,id,contextRevision]);
  for(const fragment of ["input->>'contextRevision'=$3","state IN('proposed','approved','running','uncertain')","state<>'proposed' OR EXISTS","b.state='pending'","b.manifest @> jsonb_build_array"])expect(sql).toContain(fragment);
 }
});
it('invalidates only unstarted message drafts while the invitation override retains its separate pass',async()=>{
 const query=vi.fn().mockResolvedValue({rows:[]});
 class InvalidationHarness extends AgentExecutionStore{invalidate(){return this.invalidateNativeReviews({query} as unknown as PoolClient,thread,id);}}
 const store=new InvalidationHarness({} as Pick<Pool,'connect'>,{organizationId:'org',userId:'user'});await store.invalidate();
 expect(operationNames(query.mock.calls[0][0])).toEqual(messages);expect(query.mock.calls[0][0]).toContain("state IN('proposed','approved')");expect(query.mock.calls[0][1]).toEqual([id,id]);
 class InvitationInvalidationHarness extends AgentInvitationStore{invalidate(){return this.invalidateNativeReviews({query} as unknown as PoolClient,thread,id);}}
 const invitation=new InvitationInvalidationHarness({} as Pick<Pool,'connect'>,{organizationId:'org',userId:'user'});query.mockClear();await invitation.invalidate();
 expect(query.mock.calls).toHaveLength(2);expect(operationNames(query.mock.calls[0][0])).toEqual(messages);expect(query.mock.calls[1][0]).toContain("name='linkedin.invitation' AND state IN('proposed','approved')");
});
