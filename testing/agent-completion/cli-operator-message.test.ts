import{mkdtemp,writeFile,symlink,rm}from'node:fs/promises';
import{tmpdir}from'node:os';import{join}from'node:path';
import{expect,it,vi}from'vitest';
vi.mock('server-only',()=>({}));
vi.mock('./buyer-profile',()=>({saveCompletionBuyerProfile:vi.fn()}));
vi.mock('../../src/lib/communications-bindings',()=>({recordManagedConnection:vi.fn()}));
import{runAgentCompletionCli}from'./cli';

const threadId='10000000-0000-4000-8000-000000000001',requestId='20000000-0000-4000-8000-000000000001',conversationId='30000000-0000-4000-8000-000000000001',routeId='40000000-0000-4000-8000-000000000001',scope={runId:'agent-deep-operator-test',organizationId:'owned-org',userId:'owned-user'};
function fixture(){
 const pending={id:'50000000-0000-4000-8000-000000000001',revision:1,status:'proposed',reviewBatchId:'60000000-0000-4000-8000-000000000001'},proposeNativeMessage=vi.fn(async()=>pending),forbidden={decideReviewBatch:vi.fn(),createChannelGrant:vi.fn(),controlResponsibility:vi.fn(),beginNativeCommunicationsMessage:vi.fn(),editEmailReview:vi.fn()},view={store:{proposeNativeMessage,...forbidden},runEvent:vi.fn(),serviceTick:vi.fn()},operation=vi.fn(async(_key:string,work:(view:unknown)=>Promise<unknown>)=>work(view));
 const input={conversationId,revision:7,contextRevision:'a'.repeat(64),draft:{kind:'initial_whatsapp',routeId,intent:'initial',subject:'',body:'A fictional non-binding introductory question.',rationale:'Explicit local test-operator authored draft; not model output.',sourceIds:['buyer-profile']}};
 return{runtime:{scope,operation}as never,operation,view,proposeNativeMessage,forbidden,pending,artifact:{...scope,threadId,requestId,input}};
}
it('proposes only a test-operator-authored draft through existing forced human review without execution authority',async()=>{
 const f=fixture(),result=await runAgentCompletionCli(f.runtime,['operator.message.propose','private.json'],{readReview:async()=>f.artifact});
 expect(result).toEqual({action:'operator.message.propose',authorship:'test-operator',result:f.pending});
 expect((result as{result:unknown}).result).toBe(f.pending);
 expect(f.proposeNativeMessage).toHaveBeenCalledExactlyOnceWith(threadId,requestId,f.artifact.input,undefined,{forceHumanReview:true});
 expect(f.operation).toHaveBeenCalledOnce();expect(f.view.runEvent).not.toHaveBeenCalled();expect(f.view.serviceTick).not.toHaveBeenCalled();for(const method of Object.values(f.forbidden))expect(method).not.toHaveBeenCalled();
});
it('refuses foreign run or actor scope before entering an operation',async()=>{
 const f=fixture();for(const change of[{runId:'foreign'},{organizationId:'foreign'},{userId:'foreign'}])await expect(runAgentCompletionCli(f.runtime,['operator.message.propose','private.json'],{readReview:async()=>({...f.artifact,...change})})).rejects.toThrow('Completion operator proposal scope differs');expect(f.operation).not.toHaveBeenCalled();
});
it('rejects malformed identity, stale-token shape and caller-supplied authority or source metadata before entering a pin',async()=>{
 const f=fixture(),a=f.artifact;
 const artifacts=[{...a,approved:true},{...a,authority:{}},{...a,threadId:'bad'},{...a,requestId:'bad'},...[
  {conversationId:'bad'},{revision:0},{revision:1.5},{contextRevision:'bad'},{epoch:7},{requiresHumanReview:false},{authority:{approved:true}},{recipient:'someone'},{bindingId:routeId},{replyCausality:{}},
 ].map(change=>({...a,input:{...a.input,...change}})),...[
  {recipient:'someone'},{bindingId:routeId},{replyCausality:{}},{requiresHumanReview:false},{authority:{}},{routeId:undefined},{routeId:'bad'},{kind:'invitation_linkedin'},{body:'https://example.invalid/booking'},
 ].map(change=>({...a,input:{...a.input,draft:{...a.input.draft,...change}}})),{...a,input:{...a.input,draft:{...a.input.draft,kind:'initial_email',subject:'Intro',routeId:undefined}}}];
 for(const artifact of artifacts)await expect(runAgentCompletionCli(f.runtime,['operator.message.propose','private.json'],{readReview:async()=>artifact})).rejects.toThrow('Completion operator proposal unavailable');expect(f.operation).not.toHaveBeenCalled();expect(f.proposeNativeMessage).not.toHaveBeenCalled();
});
it('requires one bounded explicit private artifact and never exposes a generic store dispatcher',async()=>{
 const f=fixture(),readReview=vi.fn(async()=>f.artifact);
 for(const argv of[['operator.message.propose'],['operator.message.propose',''],['operator.message.propose','x'.repeat(4097)],['operator.message.propose','private.json','approved'],['proposeNativeMessage','private.json'],['operator.message.propose.approve','private.json']])await expect(runAgentCompletionCli(f.runtime,argv,{readReview})).rejects.toThrow('Explicit completion command required');expect(readReview).not.toHaveBeenCalled();expect(f.operation).not.toHaveBeenCalled();
});
it('uses the existing private-file boundary and rejects public files or symlinks before a proposal',async()=>{
 const f=fixture(),directory=await mkdtemp(join(tmpdir(),'completion-operator-'));
 try{const privateFile=join(directory,'draft.json'),publicFile=join(directory,'public.json'),link=join(directory,'link.json');await writeFile(privateFile,JSON.stringify(f.artifact),{mode:0o600});await writeFile(publicFile,JSON.stringify(f.artifact),{mode:0o644});await symlink(privateFile,link);
  for(const path of[publicFile,link])await expect(runAgentCompletionCli(f.runtime,['operator.message.propose',path])).rejects.toThrow('Completion operator proposal unavailable');expect(f.operation).not.toHaveBeenCalled();
  await runAgentCompletionCli(f.runtime,['operator.message.propose',privateFile]);expect(f.proposeNativeMessage).toHaveBeenCalledExactlyOnceWith(threadId,requestId,f.artifact.input,undefined,{forceHumanReview:true});
 }finally{await rm(directory,{recursive:true,force:true});}
});
it('passes original request idempotency and existing route/history/ownership refusal unchanged without retry',async()=>{
 const f=fixture(),error=Error('Current original route is waiting, cancelled or foreign');f.proposeNativeMessage.mockRejectedValue(error);
 await expect(runAgentCompletionCli(f.runtime,['operator.message.propose','private.json'],{readReview:async()=>f.artifact})).rejects.toBe(error);
 expect(f.proposeNativeMessage).toHaveBeenCalledExactlyOnceWith(threadId,requestId,f.artifact.input,undefined,{forceHumanReview:true});expect(f.operation).toHaveBeenCalledOnce();for(const method of Object.values(f.forbidden))expect(method).not.toHaveBeenCalled();expect(f.view.runEvent).not.toHaveBeenCalled();expect(f.view.serviceTick).not.toHaveBeenCalled();
});
