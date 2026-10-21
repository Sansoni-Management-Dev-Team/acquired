import{it,expect,vi}from'vitest';import{renderToStaticMarkup}from'react-dom/server';import{AgentChannelPolicyControls,initialAgentChannelSelection,agentChannelAccountLabel}from'./agent-channel-policy-controls';
const accounts=(['email','whatsapp','linkedin'] as const).map((channel,i)=>({channel,bindingId:`00000000-0000-4000-8000-00000000000${i+1}`,bindingDigest:'a'.repeat(64),label:'[SIMULATED] '+channel}));
it('preselects the only eligible account per channel without saving or approving anything',()=>{const save=vi.fn(),html=renderToStaticMarkup(<AgentChannelPolicyControls value={{policy:null,accounts}} busy={false} onSave={save}/>);for(const label of ['Email','WhatsApp','LinkedIn','verified reply on any channel','24','Timing and order'])expect(html).toContain(label);for(const account of accounts)expect(html).toContain(`value="${account.bindingId}" selected=""`);expect(html).not.toMatch(/disabled=""[^>]*>Save reviewed channel policy/);expect(save).not.toHaveBeenCalled();expect(html).not.toContain('Fast local simulation');});
it('uses eligible exact defaults, leaves ambiguous choices empty, and enables only available channels',()=>{
 const other={...accounts[0],bindingId:'second-email',isDefault:true},old={...accounts[0],bindingId:'old-email',isDefault:true,eligibleForNewWork:false};
 expect(initialAgentChannelSelection({policy:null,accounts:[accounts[0],other,old]})).toEqual({channelOrder:['email'],bindings:{email:'second-email'}});
 expect(initialAgentChannelSelection({policy:null,accounts:[accounts[0],{...other,isDefault:false}]})).toEqual({channelOrder:['email'],bindings:{}});
 expect(initialAgentChannelSelection({policy:null,accounts:[old]})).toEqual({channelOrder:['email'],bindings:{}});
 // A real saved default absent from this mandate's allowed simulated choices
 // cannot override its only eligible demo account.
 expect(initialAgentChannelSelection({policy:null,accounts:[accounts[2]]})).toEqual({channelOrder:['linkedin'],bindings:{linkedin:accounts[2].bindingId}});
});
it('never replaces saved policy bindings/order with new defaults or fills missing historical choices',()=>{
 const policy={revision:3,channelOrder:['whatsapp','email'] as ('email'|'whatsapp')[],delaySeconds:86400,acceleratedSimulation:false,bindings:[{...accounts[1],bindingId:'historical-binding'}]};
 expect(initialAgentChannelSelection({policy,accounts:accounts.map(a=>({...a,isDefault:true}))})).toEqual({channelOrder:['whatsapp','email'],bindings:{whatsapp:'historical-binding'}});
});
it('renders only saved exact accounts and local simulation controls explicitly',()=>{const html=renderToStaticMarkup(<AgentChannelPolicyControls value={{policy:{revision:2,channelOrder:['whatsapp','email','linkedin'],delaySeconds:10,acceleratedSimulation:true,bindings:accounts},accounts}} busy={false} allowAcceleration onSave={vi.fn()}/>);expect(html).toContain('Fast local simulation');expect(html).toContain('1. ');expect(html).toContain('Simulated WhatsApp account');expect(html).toContain('does not select leads');});
it('uses concise account labels while preserving meaningful real addresses and distinct choices',()=>{
 const opaque={...accounts[0],label:'email · gmail · physical-'+'a'.repeat(64)};
 expect(agentChannelAccountLabel(opaque,true,1)).toBe('Simulated email account');
 expect(agentChannelAccountLabel(opaque,true,2)).toBe('Simulated email account · …000001');
 expect(agentChannelAccountLabel(opaque,false,1)).toBe('Gmail account · …000001');
 const named={...opaque,label:'email · gmail · owner@example.com'};
 expect(agentChannelAccountLabel(named,false,2)).toBe(named.label);
 const html=renderToStaticMarkup(<AgentChannelPolicyControls value={{policy:null,accounts:[opaque]}} busy={false} allowAcceleration onSave={vi.fn()}/>);
 expect(html).toContain('Simulated email account');expect(html).not.toContain('physical-');
});
it('submits only the explicitly reviewed account/order and current policy revision, with no change-time autosave',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;const save=vi.fn(async()=>({}));
 try{
  await act(async()=>{tree=create(<AgentChannelPolicyControls value={{policy:null,accounts}} busy={false} onSave={save}/>);});
  for(const account of accounts)await act(async()=>{tree!.root.findAllByType('select').find(row=>row.props['aria-label']===(account.channel==='email'?'Email':account.channel==='whatsapp'?'WhatsApp':'LinkedIn')+' sender')!.props.onChange({target:{value:account.bindingId}});});
  await act(async()=>{tree!.root.findAllByType('button').find(row=>row.props['aria-label']==='Move LinkedIn earlier')!.props.onClick();});
  expect(save).not.toHaveBeenCalled();
  await act(async()=>{tree!.root.findByType('form').props.onSubmit({preventDefault:vi.fn()});});
  expect(save).toHaveBeenCalledExactlyOnceWith({expectedRevision:0,channelOrder:['email','linkedin','whatsapp'],delaySeconds:86400,bindings:[accounts[0],accounts[2],accounts[1]].map(({channel,bindingId})=>({channel,bindingId})),acceleratedSimulation:false});
 }finally{if(tree)await act(async()=>tree!.unmount());vi.unstubAllGlobals();}
});
