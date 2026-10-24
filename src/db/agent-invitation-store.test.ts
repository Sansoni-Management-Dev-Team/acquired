import{afterEach,it,expect,vi}from'vitest';import type{PoolClient,Pool}from'pg';import{AgentInvitationStore}from'./agent-invitation-store';import{AgentChannelStore}from'./agent-channel-store';import type{AgentThread}from'./agent-store';
vi.mock('server-only',()=>({}));
const t:AgentThread={id:'thread',organization_id:'org',owner_user_id:'actor',mandate_id:'mandate',revision:1};
class TestStore extends AgentInvitationStore{events:{kind:string;value:unknown}[]=[];protected override async nativeTransaction<T>(work:(c:PoolClient)=>Promise<T>){return work({}as PoolClient);}protected override async thread(){return t;}protected override async emit(_c:PoolClient,_t:AgentThread,_key:string,kind:string,value:unknown){this.events.push({kind,value});}}
afterEach(()=>vi.restoreAllMocks());
it('forces every invitation proposal through HIL and emits acknowledgement without email delegation',async()=>{const base=vi.spyOn(AgentChannelStore.prototype,'proposeNativeMessage').mockResolvedValue({id:'op',revision:1,status:'proposed',reviewBatchId:'review'}),s=new TestStore({}as Pool,{organizationId:'org',userId:'actor'}),raw={draft:{kind:'invitation_linkedin'}};await s.proposeNativeMessage('thread','key',raw,undefined,{forceHumanReview:false});expect(base).toHaveBeenCalledWith('thread','key',raw,undefined,{forceHumanReview:true});expect(s.events).toEqual([{kind:'linkedin.invitation_proposed',value:{operationId:'op',reviewBatchId:'review'}}]);});
it('preserves original message proposal options without an invitation acknowledgement',async()=>{const base=vi.spyOn(AgentChannelStore.prototype,'proposeNativeMessage').mockResolvedValue({id:'op',revision:1,status:'proposed',reviewBatchId:'review'}),s=new TestStore({}as Pool,{organizationId:'org',userId:'actor'}),raw={draft:{kind:'reply_whatsapp'}};await s.proposeNativeMessage('thread','key',raw,undefined,{forceHumanReview:false});expect(base).toHaveBeenCalledWith('thread','key',raw,undefined,{forceHumanReview:false});expect(s.events).toEqual([]);});
it('rejects delegated invitation execution before any transaction can reserve a send',async()=>{const s=new TestStore({}as Pool,{organizationId:'org',userId:'actor'});vi.spyOn(s,'channelDispatchRecord').mockResolvedValue({operation:{name:'linkedin.invitation'},conversation:{},route:null,submitted:false,notSubmitted:false}as never);await expect(s.beginNativeCommunicationsMessage('thread','op',undefined,{id:'grant',revision:1})).rejects.toThrow('exact human review');expect(s.events).toEqual([]);});

it('preserves the dispatch account snapshot request for ordinary messages through the invitation store',async()=>{
 class SnapshotStore extends TestStore{protected override async nativeTransaction<T>(work:(c:PoolClient)=>Promise<T>){return work({query:async()=>({rows:[]})}as unknown as PoolClient);}}
 const record={conversation:{},operation:{name:'email.initial'},route:null,submitted:false,notSubmitted:false,originalAccount:{id:'original'}};
 const base=vi.spyOn(AgentChannelStore.prototype,'channelDispatchRecord').mockResolvedValue(record as never);
 const s=new SnapshotStore({}as Pool,{organizationId:'org',userId:'actor'}),options={includeOriginalAccount:true};
 expect(await s.channelDispatchRecord('thread','10000000-0000-4000-8000-000000000001',options)).toBe(record);
 expect(base).toHaveBeenCalledWith('thread','10000000-0000-4000-8000-000000000001',options);
});

it.each(['email.initial','whatsapp.initial','linkedin.initial'])('reads the original %s dispatch snapshot once before the final locked authority check',async name=>{
 class GuardStore extends TestStore{
  protected override async lockThread(){return t;}
  protected override async assertExecutionFence(){throw Error('final authority check retained');}
 }
 const s=new GuardStore({}as Pool,{organizationId:'org',userId:'actor'});
 const snapshot=vi.spyOn(s,'channelDispatchRecord').mockResolvedValue({operation:{name},conversation:{},route:{id:'route'},submitted:false,notSubmitted:false}as never);
 await expect(s.beginNativeCommunicationsMessage('thread','operation')).rejects.toThrow('final authority check retained');
 expect(snapshot).toHaveBeenCalledTimes(1);
});

it('keeps the original legacy email admission when the owned dispatch has no recorded route',async()=>{
 const s=new TestStore({}as Pool,{organizationId:'org',userId:'actor'});
 const snapshot=vi.spyOn(s,'channelDispatchRecord').mockResolvedValue({operation:{name:'email.initial'},conversation:{},route:null,submitted:false,notSubmitted:false}as never);
 const legacy=vi.spyOn(s,'beginNativeCommunicationsEmail').mockRejectedValue(Error('original legacy authority'));
 await expect(s.beginNativeCommunicationsMessage('thread','operation')).rejects.toThrow('original legacy authority');
 expect(snapshot).toHaveBeenCalledTimes(1);expect(legacy).toHaveBeenCalledWith('thread','operation',undefined,undefined);
});

it('bundles owned dispatch preparation and consumes its begin handle even when the final fence rejects',async()=>{
 class PreparedStore extends TestStore{
  bundles=0;
  protected override async readBundle<T>(work:()=>Promise<T>){this.bundles++;return work();}
  protected override async lockThread(){return t;}
  protected override async assertExecutionFence(){throw Error('final fence retained');}
 }
 const s=new PreparedStore({}as Pool,{organizationId:'org',userId:'actor'}),conversationId='10000000-0000-4000-8000-000000000002';
 const record={operation:{name:'email.initial'},conversation:{id:conversationId},route:{id:'route',bindingDigest:'digest'},submitted:false,notSubmitted:false};
 vi.spyOn(s,'channelDispatchRecord').mockResolvedValue(record as never);
 vi.spyOn(s,'historyAccountSnapshot').mockResolvedValue({conversation:record.conversation,routes:[],accounts:[]}as never);
 vi.spyOn(s,'preBeginHistoryRetryProof').mockResolvedValue(true);
 const prepared=await s.dispatchPreparationSnapshot('thread','10000000-0000-4000-8000-000000000001',conversationId);
 expect(s.bundles).toBe(1);expect(prepared.preBegin).toBe(true);
 await expect(prepared.begin()).rejects.toThrow('final fence retained');
 await expect(prepared.begin()).rejects.toThrow('already consumed');
 expect(s.channelDispatchRecord).toHaveBeenCalledTimes(1);
});
it('refuses a preparation snapshot for a different conversation before creating a handle',async()=>{
 class PreparedStore extends TestStore{protected override async readBundle<T>(work:()=>Promise<T>){return work();}}
 const s=new PreparedStore({}as Pool,{organizationId:'org',userId:'actor'});
 vi.spyOn(s,'channelDispatchRecord').mockResolvedValue({conversation:{id:'foreign'}}as never);
 const history=vi.spyOn(s,'historyAccountSnapshot');
 await expect(s.dispatchPreparationSnapshot('thread','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002')).rejects.toThrow('conversation');
 expect(history).not.toHaveBeenCalled();
});
it('rejects route drift under the final transaction instead of trusting the advisory snapshot',async()=>{
 class DriftStore extends TestStore{
  protected override async readBundle<T>(work:()=>Promise<T>){return work();}
  protected override async nativeTransaction<T>(work:(c:PoolClient)=>Promise<T>){return work({query:async()=>({rows:[{}]})}as unknown as PoolClient);}
  protected override async lockThread(){return t;}
  protected override async assertExecutionFence(){}
  protected override async nativeOperationRoute(){return {id:'changed-route',bindingDigest:'changed'}as never;}
 }
 const s=new DriftStore({}as Pool,{organizationId:'org',userId:'actor'}),person='10000000-0000-4000-8000-000000000002';
 vi.spyOn(s,'channelDispatchRecord').mockResolvedValue({operation:{name:'email.initial'},conversation:{id:person},route:{id:'original-route',bindingDigest:'original'},submitted:false,notSubmitted:false}as never);
 vi.spyOn(s,'historyAccountSnapshot').mockResolvedValue({conversation:{id:person},routes:[],accounts:[]}as never);vi.spyOn(s,'preBeginHistoryRetryProof').mockResolvedValue(true);
 const handle=await s.dispatchPreparationSnapshot('thread','10000000-0000-4000-8000-000000000001',person);
 await expect(handle.begin()).rejects.toThrow('Original dispatch route changed');
});
