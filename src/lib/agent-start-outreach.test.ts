import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {startAgentOutreach,initializeAgentChannelDefaults} from './agent-start-outreach';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor={organizationId:'org',userId:'user'};
function fixture(){
 const accounts=(['email','whatsapp','linkedin'] as const).map((channel,i)=>({channel,bindingId:id(i+10),bindingDigest:'a'.repeat(64),label:channel,eligibleForNewWork:true}));
 const policy={revision:1,channelOrder:accounts.map(a=>a.channel),bindings:accounts,delaySeconds:86400,acceleratedSimulation:false};
 const state={executionMode:'demo',mandateRevision:'42',responsibility:{state:'ready',mandate_revision:'42'},demoContacts:{prepared:0,stale:0,outreachReady:false}};
 const store={executionState:vi.fn().mockResolvedValue(state),demoOutreachAccounts:vi.fn(async()=>accounts),channelPolicy:vi.fn().mockResolvedValue({policy:null,accounts}),saveChannelPolicy:vi.fn().mockResolvedValue({revision:1}),proposeTargetSelection:vi.fn().mockResolvedValue({status:'proposed'})};
 const prepare=vi.fn().mockResolvedValue({kind:'demo',prepared:50});
 return {accounts,policy,state,store,prepare,run:()=>startAgentOutreach({actor,mandateId:id(1),threadId:id(2),requestKey:id(3),store,prepare})};
}
beforeEach(()=>vi.clearAllMocks());
it('one start prepares demo recipients, saves all scoped channel defaults and proposes contacts without approving or sending',async()=>{
 const f=fixture();expect(await f.run()).toEqual({status:'proposed'});
 expect(f.prepare).toHaveBeenCalledWith(actor,id(1),expect.any(String));
 expect(f.store.saveChannelPolicy).toHaveBeenCalledWith(id(2),expect.any(String),{expectedRevision:0,channelOrder:['email','whatsapp','linkedin'],bindings:f.accounts.map(({channel,bindingId})=>({channel,bindingId})),delaySeconds:86400,acceleratedSimulation:false});
 expect(f.prepare.mock.invocationCallOrder[0]).toBeLessThan(f.store.channelPolicy.mock.invocationCallOrder[0]);
 expect(f.store.proposeTargetSelection).toHaveBeenCalledWith(id(2),expect.any(String),{mode:'channels',policyRevision:1});
});
it('chooses the recorded system default rather than the first of several eligible accounts',async()=>{
 const f=fixture();f.accounts.unshift({...f.accounts[0],bindingId:id(99)});Object.assign(f.accounts[1],{isDefault:true});await f.run();
 expect(f.store.saveChannelPolicy.mock.calls[0][2].bindings[0].bindingId).toBe(id(10));
});
it('excludes another test run even if it is marked as the system default',async()=>{
 const f=fixture();f.store.demoOutreachAccounts.mockResolvedValue([...f.accounts]);f.accounts.unshift({...f.accounts[0],bindingId:id(99),isDefault:true} as typeof f.accounts[number]);await f.run();expect(f.store.saveChannelPolicy.mock.calls[0][2].bindings[0].bindingId).toBe(id(10));
});
it('keeps saved channel order, timing and exact accounts, and skips already prepared recipients on retry',async()=>{
 const f=fixture();f.state.demoContacts.prepared=50;f.store.channelPolicy.mockResolvedValue({policy:{...f.policy,delaySeconds:10,acceleratedSimulation:true},accounts:f.accounts});
 await f.run();expect(f.prepare).not.toHaveBeenCalled();expect(f.store.saveChannelPolicy).not.toHaveBeenCalled();
});
it('reuses the same phase keys after an uncertain response',async()=>{
 const f=fixture();f.store.proposeTargetSelection.mockRejectedValueOnce(Error('unknown'));await expect(f.run()).rejects.toThrow('unknown');await f.run();
 expect(f.prepare.mock.calls[0][2]).toBe(f.prepare.mock.calls[1][2]);expect(f.store.saveChannelPolicy.mock.calls[0][1]).toBe(f.store.saveChannelPolicy.mock.calls[1][1]);expect(f.store.proposeTargetSelection.mock.calls[0][1]).toBe(f.store.proposeTargetSelection.mock.calls[1][1]);
});
it.each(['missing','ambiguous','stale_saved'] as const)('does not guess an account or overwrite saved work when accounts are %s',async kind=>{
 const f=fixture();if(kind==='missing')f.accounts.length=0;if(kind==='ambiguous')f.accounts.push({...f.accounts[0],bindingId:id(99)});if(kind==='stale_saved')f.store.channelPolicy.mockResolvedValue({policy:{...f.policy,bindings:[{...f.accounts[0],bindingDigest:'b'.repeat(64)}]},accounts:f.accounts});
 await expect(f.run()).rejects.toThrow(/account/i);expect(f.store.saveChannelPolicy).not.toHaveBeenCalled();expect(f.store.proposeTargetSelection).not.toHaveBeenCalled();
});
it.each(['paused','brief_changed','real'] as const)('does not prepare recipients or change policy when %s',async kind=>{
 const f=fixture();if(kind==='paused')f.state.responsibility.state='paused';if(kind==='brief_changed')f.state.responsibility.mandate_revision='old';if(kind==='real')f.state.executionMode='real';
 await expect(f.run()).rejects.toThrow();expect(f.prepare).not.toHaveBeenCalled();expect(f.store.saveChannelPolicy).not.toHaveBeenCalled();
});

it('inherits live mandate channel defaults on Start without replacing saved policy or blocking research on missing accounts',async()=>{
 const f=fixture();expect(await initializeAgentChannelDefaults(f.store,id(2),id(3))).toBe('initialized');expect(f.store.saveChannelPolicy).toHaveBeenCalledOnce();
 f.store.saveChannelPolicy.mockClear();f.store.channelPolicy.mockResolvedValueOnce({policy:f.policy,accounts:f.accounts});expect(await initializeAgentChannelDefaults(f.store,id(2),id(3))).toBe('saved');expect(f.store.saveChannelPolicy).not.toHaveBeenCalled();
 f.accounts.length=0;expect(await initializeAgentChannelDefaults(f.store,id(2),id(3))).toBe('needs_settings');expect(f.store.saveChannelPolicy).not.toHaveBeenCalled();
});
it('starts a live workflow using saved account defaults without simulator preparation',async()=>{const f=fixture();Object.assign(f.state,{executionMode:'real',workflowPreset:'live'});await f.run();expect(f.prepare).not.toHaveBeenCalled();expect(f.store.demoOutreachAccounts).not.toHaveBeenCalled();expect(f.store.proposeTargetSelection).toHaveBeenCalledOnce();});
it('refuses research-only before provisioning, policy or selection',async()=>{const f=fixture();Object.assign(f.state,{workflowPreset:'live-research-test'});await expect(f.run()).rejects.toThrow('research-only');expect(f.prepare).not.toHaveBeenCalled();expect(f.store.channelPolicy).not.toHaveBeenCalled();expect(f.store.proposeTargetSelection).not.toHaveBeenCalled();});
it('leaves workflow ready after a proposal; outreach requires committed conversations',async()=>{const f=fixture(),mark=vi.fn(async()=>{throw Object.assign(Error('Execution has no recorded conversations'),{code:'55000'});});Object.assign(f.state,{workflowExecutionId:id(9),workflowPreset:'demo'});Object.assign(f.store,{markWorkflowOutreach:mark});await expect(f.run()).resolves.toBeDefined();expect(f.store.proposeTargetSelection).toHaveBeenCalledOnce();expect(mark).not.toHaveBeenCalled();});
