import{it,expect,vi}from'vitest';import{renderToStaticMarkup}from'react-dom/server';import{AgentChannelPolicyControls}from'./agent-channel-policy-controls';
const accounts=(['email','whatsapp','linkedin'] as const).map((channel,i)=>({channel,bindingId:`00000000-0000-4000-8000-00000000000${i+1}`,bindingDigest:'a'.repeat(64),label:'[SIMULATED] '+channel}));
it('defaults to staggered3channel intent but never guesses or saves sender accounts',()=>{const save=vi.fn(),html=renderToStaticMarkup(<AgentChannelPolicyControls value={{policy:null,accounts}} busy={false} onSave={save}/>);for(const label of ['Email','WhatsApp','LinkedIn','verified reply on any channel','24','Choose a recorded account'])expect(html).toContain(label);expect(html).toMatch(/disabled=""[^>]*>Save reviewed channel policy/);expect(save).not.toHaveBeenCalled();expect(html).not.toContain('Fast local simulation');});
it('renders only saved exact accounts and local simulation controls explicitly',()=>{const html=renderToStaticMarkup(<AgentChannelPolicyControls value={{policy:{revision:2,channelOrder:['whatsapp','email','linkedin'],delaySeconds:10,acceleratedSimulation:true,bindings:accounts},accounts}} busy={false} allowAcceleration onSave={vi.fn()}/>);expect(html).toContain('Fast local simulation');expect(html).toContain('1. ');expect(html).toContain('[SIMULATED] whatsapp');expect(html).toContain('does not select leads');});
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
