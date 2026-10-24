import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {AgentControlsPanel,type AgentControlsData} from './agent-controls-panel';
import {AGENT_DEMO_AUTO_APPROVAL_ALL} from './agent-demo-auto-approval';
const renderConversation=(content:React.ReactNode)=><article aria-label="Mandate conversation">{content}</article>;
const data:AgentControlsData={enabled:false,state:{mandateRevision:'42',responsibility:null,conversations:[]},inbox:{tasks:[],members:[]},grants:[]};
it('keeps demo contact allocation disabled after choosing a delivery mode until simulated routes are prepared',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();vi.stubGlobal('document',{visibilityState:'visible'});const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;vi.stubGlobal('fetch',vi.fn());
 try{
  const initial:AgentControlsData={...data,enabled:true,simulationEnabled:true,channelPolicy:{policy:{revision:1,channelOrder:['email'],delaySeconds:86400,bindings:[],acceleratedSimulation:false},accounts:[]},state:{...data.state!,executionMode:'demo',responsibility:{id:'responsibility',state:'ready',revision:1,owner_user_id:'owner'}}};
  await act(()=>{tree=create(<AgentControlsPanel mandateId="mandate" initial={initial}>{renderConversation}</AgentControlsPanel>)});
  const select=tree!.root.findAllByType('select').find(s=>s.findAllByType('option').some(o=>o.props.value==='channels'))!;
  await act(()=>select.props.onChange({target:{value:'channels'}}));
  expect(tree!.root.findAllByType('button').find(b=>b.children.join('')==='Prepare contact selection')!.props.disabled).toBe(true);
  expect(fetch).not.toHaveBeenCalled();expect(JSON.stringify(tree!.toJSON())).toContain('Demo · simulated outreach');
 }finally{if(tree)await act(()=>tree!.unmount());vi.useRealTimers();vi.unstubAllGlobals();}
});
it('keeps execution honest without a duplicate header start when native execution is unavailable',()=>{const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={data}>{renderConversation}</AgentControlsPanel>);expect(html).toContain('Native execution is disabled');expect(html).not.toContain('Start agent');expect(html).toContain('disabled');expect(html).not.toContain('Agent is running');});
it('shows human assigned tasks even without an owned supervision thread',()=>{const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={{...data,state:null,inbox:{members:[],tasks:[{id:'task',revision:1,state:'pending',assignee_user_id:'other',owner_user_id:'owner',context_revision:'a'.repeat(64),context:{summary:'Please send booking link manually'},human_evidence:{},can_reassign:false}]}}}>{renderConversation}</AgentControlsPanel>);expect(html).toContain('Please send booking link manually');expect(html).toContain('Acknowledge');});
it('keeps bounded automatic sending behind explicit options and never offers global YOLO',()=>{const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={{...data,enabled:true,state:{...data.state!,responsibility:{id:'responsibility',state:'ready',revision:1,owner_user_id:'owner'},conversations:[{id:'conversation',revision:1,epoch:'1',context_revision:'a'.repeat(64),driver_kind:'agent',phase:'active',recipient_email:'lead@example.invalid',binding_digest:'b'.repeat(64),engagement:'engaged'}]}}}>{renderConversation}</AgentControlsPanel>);for(const text of ['Pause agent','Automatic sending limits','Human approval is the default','lead@example.invalid'])expect(html).toContain(text);expect(html).not.toContain('Approve all forever');});
it('does not fan out queued control reads and ignores late results after unmount',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;let resolveExecution:(value:Response)=>void=()=>{};const fetcher=vi.fn((url:string,options?:RequestInit)=>{if(options?.method==='POST')return Promise.resolve(Response.json({result:{}}));if(url.endsWith('/execution'))return new Promise<Response>(resolve=>{resolveExecution=resolve;});if(url.endsWith('/handoffs'))return Promise.resolve(Response.json({tasks:[],members:[]}));return Promise.resolve(Response.json({grants:[]}));});vi.stubGlobal('fetch',fetcher);vi.stubGlobal('document',{visibilityState:'visible'});
 try{await act(async()=>{tree=create(<AgentControlsPanel mandateId="mandate" initial={data}>{renderConversation}</AgentControlsPanel>);});await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(fetcher).not.toHaveBeenCalledWith(expect.stringContaining('/handoffs'),expect.anything());await act(async()=>{tree!.unmount();});resolveExecution(Response.json({enabled:true,state:null}));await act(async()=>{await Promise.resolve();});expect(fetcher).not.toHaveBeenCalledWith(expect.stringContaining('/handoffs'),expect.anything());
 }finally{vi.useRealTimers();vi.unstubAllGlobals();}
});
it('reuses an uncertain mutation key on retry instead of creating another operation',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();vi.stubGlobal('document',{visibilityState:'visible'});const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;let attempts=0;const bodies:Record<string,unknown>[]=[];
 vi.stubGlobal('fetch',vi.fn((url:string,options?:RequestInit)=>{if(options?.method==='POST'){bodies.push(JSON.parse(options.body as string));return ++attempts===1?Promise.reject(new Error('Network outcome unknown')):Promise.resolve(Response.json({result:{id:'saved'}}));}return Promise.resolve(Response.json(url.endsWith('/execution')?{enabled:true,state:data.state}:url.endsWith('/handoffs')?{tasks:[],members:[]}:{grants:[]}));}));
 try{await act(async()=>{tree=create(<AgentControlsPanel mandateId="mandate" initial={{...data,enabled:true,state:{...data.state!,responsibility:{id:'r',state:'ready',revision:1,owner_user_id:'owner'}}}}>{renderConversation}</AgentControlsPanel>);});const click=()=>tree!.root.findAllByType('button').find(b=>b.props.children==='Pause agent')!.props.onClick();await act(async()=>{click();await Promise.resolve();});await act(async()=>{click();await Promise.resolve();});expect(bodies).toHaveLength(2);expect(bodies[0].requestKey).toBe(bodies[1].requestKey);
 }finally{if(tree)await act(async()=>tree!.unmount());vi.useRealTimers();vi.unstubAllGlobals();}
});
it('delegates only explicitly selected conversations on one account with reply-only defaults and a finite cap',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();vi.stubGlobal('document',{visibilityState:'visible'});const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;const bodies:Record<string,unknown>[]=[];
 const conversation={id:'first',revision:1,epoch:'1',context_revision:'a'.repeat(64),driver_kind:'agent',phase:'active',recipient_email:'first@example.invalid',binding_digest:'b'.repeat(64),engagement:'engaged'};
 const initial={...data,enabled:true,state:{mandateRevision:'42',responsibility:{id:'responsibility',state:'ready',revision:1,owner_user_id:'owner'},conversations:[conversation,{...conversation,id:'second',recipient_email:'second@example.invalid',binding_digest:'c'.repeat(64)}]}};
 vi.stubGlobal('fetch',vi.fn((url:string,options?:RequestInit)=>{if(options?.method==='POST'){bodies.push(JSON.parse(options.body as string));return Promise.resolve(Response.json({result:{}}));}return Promise.resolve(Response.json(url.endsWith('/execution')?{enabled:true,state:initial.state}:url.endsWith('/handoffs')?{tasks:[],members:[]}:{grants:[]}));}));
 try{await act(async()=>{tree=create(<AgentControlsPanel mandateId="mandate" initial={initial}>{renderConversation}</AgentControlsPanel>);});const checkboxes=()=>tree!.root.findByProps({'aria-label':'Automatic sending permissions'}).findAllByType('input').filter(input=>input.props.type==='checkbox');await act(async()=>{checkboxes()[0].props.onChange({target:{checked:true}});});expect(checkboxes()[1].props.disabled).toBe(true);await act(async()=>{tree!.root.findAllByType('input').find(input=>input.props.type==='datetime-local')!.props.onChange({target:{value:'2026-10-18T10:00'}});checkboxes().at(-1)!.props.onChange({target:{checked:true}});});await act(async()=>{await tree!.root.findAllByType('form').find(form=>form.props['aria-label']==='Automatic sending permissions')!.props.onSubmit({preventDefault(){}});});expect(bodies).toHaveLength(1);expect(bodies[0]).toMatchObject({action:'create',mandateRevision:'42',conversationIds:['first'],actions:['reply_email'],maxSends:1});expect(bodies[0]).not.toHaveProperty('recipientKeys');expect(bodies[0]).not.toHaveProperty('bindingDigest');
 }finally{if(tree)await act(async()=>tree!.unmount());vi.useRealTimers();vi.unstubAllGlobals();}
});
it('offers an explicit agent handback after a dismissed handoff while active handoffs remain paused',()=>{
 const conversation={id:'conversation',contact_id:'contact',revision:1,epoch:'1',context_revision:'a'.repeat(64),driver_kind:'human',phase:'paused',recipient_email:'lead@example.invalid',engagement:'handoff'};
 const state={mandateRevision:'42',responsibility:{id:'responsibility',state:'ready',revision:1,owner_user_id:'owner'},conversations:[conversation]};
 const task={id:'task',revision:1,state:'dismissed' as const,assignee_user_id:'owner',owner_user_id:'owner',context_revision:'a'.repeat(64),context:{contactId:'contact',summary:'Human resolved handoff'},human_evidence:{},can_reassign:true};
 const render=(taskState:'pending'|'dismissed'|'meeting_confirmed')=>renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={{...data,enabled:true,state,inbox:{members:[],tasks:[{...task,state:taskState}]}}}>{renderConversation}</AgentControlsPanel>);
 expect(render('dismissed')).toContain('Move to agent');expect(render('pending')).not.toContain('Move to agent');expect(render('meeting_confirmed')).not.toContain('Move to agent');
});
it('offers held no-submission refresh and explicit resume rather than a same-agent ownership transfer',()=>{
 const conversation={id:'conversation',revision:2,epoch:'3',context_revision:'a'.repeat(64),driver_kind:'agent',phase:'held',pause_reason:'provider_no_submission_confirmed',recipient_email:'lead@example.invalid',engagement:'engaged'};const state={mandateRevision:'42',responsibility:{id:'responsibility',state:'ready',revision:1,owner_user_id:'owner'},conversations:[conversation]};const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={{...data,enabled:true,state}}>{renderConversation}</AgentControlsPanel>);expect(html).toContain('Check previous messages');expect(html).toContain('Resume agent');expect(html).not.toContain('Move to agent');
});
it('keeps advanced settings mounted inside a closed native inspector, with actionable handoffs outside it',()=>{
 const initial={...data,inbox:{members:[],tasks:[{id:'task',revision:1,state:'pending' as const,assignee_user_id:'owner',owner_user_id:'owner',context_revision:'a'.repeat(64),context:{summary:'Please send booking link manually'},human_evidence:{},can_reassign:false}]}};
 const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={initial}>{renderConversation}</AgentControlsPanel>);
 expect(html).toContain('Agent off');expect(html).toContain('aria-label="Agent settings"');
 expect(html).toMatch(/<dialog[^>]*aria-labelledby=/);expect(html).not.toMatch(/<dialog[^>]*\sopen(?:=|>)/);
 const dialog=html.slice(html.indexOf('<dialog'),html.indexOf('</dialog>'));
 for(const label of ['Review cached contacts','Automatic sending permissions','Structured sequences'])expect(dialog).toContain(label);
 expect(dialog).not.toContain('Please send booking link manually');expect(html).toContain('Please send booking link manually');
 expect(html).not.toContain('role="dialog"');
});
it('opens and closes the native settings inspector without clearing edited permissions or posting commands',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();vi.stubGlobal('document',{visibilityState:'visible'});const fetcher=vi.fn().mockResolvedValue(Response.json({}));vi.stubGlobal('fetch',fetcher);
 const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;const modal={open:false,showModal:vi.fn(function(){modal.open=true;}),close:vi.fn(function(){modal.open=false;})};
 try{
  await act(async()=>{tree=create(<AgentControlsPanel mandateId="mandate" initial={{...data,enabled:true}}>{renderConversation}</AgentControlsPanel>,{createNodeMock:element=>element.type==='dialog'?modal:null});});
  const settings=()=>tree!.root.findAllByType('button').find(button=>button.props['aria-label']==='Agent settings')!;
  expect(settings().props['aria-expanded']).toBe(false);await act(async()=>settings().props.onClick());expect(modal.showModal).toHaveBeenCalledTimes(1);expect(settings().props['aria-expanded']).toBe(true);
  const capInput=()=>tree!.root.findAllByType('input').find(input=>input.props.type==='number'&&input.props.max===100)!;
  await act(async()=>{capInput().props.onChange({target:{value:'7'}});tree!.root.findAllByType('input').find(input=>input.props.maxLength===100)!.props.onChange({target:{value:'Unsaved sequence draft'}});});
  await act(async()=>tree!.root.findAllByType('button').find(button=>button.props['aria-label']==='Close settings')!.props.onClick());expect(modal.close).toHaveBeenCalledTimes(1);expect(settings().props['aria-expanded']).toBe(false);
  await act(async()=>settings().props.onClick());expect(capInput().props.value).toBe(7);expect(tree!.root.findAllByType('input').find(input=>input.props.maxLength===100)!.props.value).toBe('Unsaved sequence draft');
  const cancel={preventDefault:vi.fn()};await act(async()=>tree!.root.findByType('dialog').props.onCancel(cancel));expect(cancel.preventDefault).toHaveBeenCalled();expect(settings().props['aria-expanded']).toBe(false);
  await act(async()=>settings().props.onClick());
  const backdrop={getBoundingClientRect:()=>({left:800,right:1280,top:0,bottom:900})};
  await act(async()=>tree!.root.findByType('dialog').props.onClick({target:{},currentTarget:backdrop,clientX:10,clientY:10}));expect(settings().props['aria-expanded']).toBe(true);
  await act(async()=>tree!.root.findByType('dialog').props.onClick({target:backdrop,currentTarget:backdrop,clientX:1000,clientY:100}));expect(settings().props['aria-expanded']).toBe(true);
  await act(async()=>tree!.root.findByType('dialog').props.onClick({target:backdrop,currentTarget:backdrop,clientX:10,clientY:10}));expect(settings().props['aria-expanded']).toBe(false);
  expect(fetcher.mock.calls.filter(([,options])=>options?.method==='POST')).toHaveLength(0);
 }finally{if(tree)await act(async()=>tree!.unmount());vi.useRealTimers();vi.unstubAllGlobals();}
});
it('shows actionable runtime readiness instead of claiming an unregistered mandate is active',()=>{const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={{...data,enabled:true,state:{...data.state!,responsibility:{id:'r',state:'ready',revision:1,owner_user_id:'owner'}},readiness:{registered:false,runtimeId:null,responsibilityRevision:null,reason:'Resume agent to register this mandate.',budgets:[],channels:[{channel:'whatsapp',bindingId:null,generationDigest:null,ready:false,reason:'Connect a simulated WhatsApp account.'}]},configuration:{enabled:true,scopeMode:'registered',modelConfigured:false,researchConfigured:false,simulation:true}}}>{renderConversation}</AgentControlsPanel>);expect(html).toContain('Agent needs setup');expect(html).toContain('Resume agent to register');expect(html).toContain('Connect a simulated WhatsApp');expect(html).toContain('Configure the model');expect(html).not.toContain('>Agent active<');});
it('offers explicit current-CAS resume after criteria save without automatically continuing supervision',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();vi.stubGlobal('document',{visibilityState:'visible'});
 const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;const bodies:Record<string,unknown>[]=[];
 const initial:AgentControlsData={...data,enabled:true,state:{mandateRevision:'124',responsibility:{id:'responsibility',state:'ready',revision:3,owner_user_id:'owner',mandate_revision:'123'},conversations:[]}};
 vi.stubGlobal('fetch',vi.fn((url:string,options?:RequestInit)=>{if(options?.method==='POST'){bodies.push(JSON.parse(options.body as string));return Promise.resolve(Response.json({result:{}}));}return Promise.resolve(Response.json(url.endsWith('/execution')?{enabled:true,state:initial.state}:url.endsWith('/handoffs')?{tasks:[],members:[]}:{grants:[]}));}));
 try{
  await act(async()=>{tree=create(<AgentControlsPanel mandateId="mandate" initial={initial}>{renderConversation}</AgentControlsPanel>);});
  expect(bodies).toHaveLength(0);
  expect(tree!.root.findAllByType('button').some(b=>b.props.children==='Pause agent')).toBe(true);
  const resume=tree!.root.findAllByType('button').find(b=>b.props.children==='Resume with reviewed brief');expect(resume).toBeDefined();
  await act(async()=>resume!.props.onClick());
  expect(bodies).toHaveLength(1);expect(bodies[0]).toMatchObject({action:'resume',expectedRevision:3,mandateRevision:'124'});expect(typeof bodies[0].requestKey).toBe('string');
 }finally{if(tree)await act(async()=>tree!.unmount());vi.useRealTimers();vi.unstubAllGlobals();}
});
it('does not infer a changed brief from absent legacy revision metadata and preserves the paused resume path',()=>{
 for(const state of ['ready','paused'])for(const mandate_revision of [undefined,'124']){
  const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={{...data,enabled:true,state:{mandateRevision:'124',responsibility:{id:'responsibility',state,revision:3,owner_user_id:'owner',mandate_revision},conversations:[]}}}>{renderConversation}</AgentControlsPanel>);
  expect(html).not.toContain('Resume with reviewed brief');expect(html).toContain(state==='paused'?'Resume agent':'Pause agent');
 }
});

it('keeps demo delivery choices free of real account and sink fallbacks',()=>{const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={{...data,enabled:true,simulationEnabled:true,targetOptions:{simulationEnabled:true,bindings:[{id:'real-binding',label:'UNRELATED_REAL_EMAIL_ACCOUNT'}]},state:{...data.state!,executionMode:'demo',demoContacts:{prepared:2,stale:0,outreachReady:true}}}}>{renderConversation}</AgentControlsPanel>);expect(html).toContain('Demo · simulated outreach');expect(html.match(/Delivery mode \/ account<select[^>]*>(.*?)<\/select>/)?.[1]).not.toContain('UNRELATED_REAL_EMAIL_ACCOUNT');expect(html).not.toContain('Local simulation — no provider email');expect(html).not.toContain('Outreach is disabled until');});
function selectedEmailReadiness():AgentControlsData{return {...data,enabled:true,state:{...data.state!,responsibility:{id:'r',state:'ready',revision:1,owner_user_id:'owner'}},configuration:{enabled:true,scopeMode:'registered',modelConfigured:true,researchConfigured:true,simulation:true},channelPolicy:{policy:{revision:2,channelOrder:['email'],delaySeconds:10,bindings:[{channel:'email',bindingId:'selected-email',bindingDigest:'a'.repeat(64)}],acceleratedSimulation:true},accounts:[]},readiness:{registered:true,runtimeId:'runtime',responsibilityRevision:1,reason:null,budgets:[],channels:[{channel:'email',bindingId:'selected-email',generationDigest:'a'.repeat(64),ready:true,reason:null,readiness:'connected'},{channel:'whatsapp',bindingId:null,generationDigest:null,ready:false,reason:'choose_recorded_account'},{channel:'linkedin',bindingId:null,generationDigest:null,ready:false,reason:'choose_recorded_account'}]}};}
it('shows active supervision when the exact selected email is ready without requiring unselected social accounts',()=>{
 const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={selectedEmailReadiness()}>{renderConversation}</AgentControlsPanel>);
 expect(html).toContain('>Agent active<');expect(html).not.toContain('Agent needs setup');expect(html).not.toContain('Setup needs attention');expect(html).toContain('whatsapp: Not selected for this mandate.');expect(html).toContain('linkedin: Not selected for this mandate.');expect(html).toContain('full conversation history checked before dispatch');expect(html).toContain('Pause agent');
});
it.each(['missing','wrong_binding','wrong_generation','not_ready']as const)('retains setup warning for a selected email with %s readiness',kind=>{
 const initial=selectedEmailReadiness();const channel=initial.readiness!.channels[0];if(kind==='missing')initial.readiness!.channels.shift();if(kind==='wrong_binding')channel.bindingId='another-email';if(kind==='wrong_generation')channel.generationDigest='b'.repeat(64);if(kind==='not_ready'){channel.ready=false;channel.reason='recorded_account_reconnect';channel.readiness='verification_required';}
 const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={initial}>{renderConversation}</AgentControlsPanel>);expect(html).toContain('Agent needs setup');expect(html).not.toContain('>Agent active<');
});
it.each(['model','registration','no_policy','selected_social']as const)('preserves other setup requirements: %s',kind=>{
 const initial=selectedEmailReadiness();if(kind==='model')initial.configuration!.modelConfigured=false;if(kind==='registration')initial.readiness!.registered=false;if(kind==='no_policy')initial.channelPolicy!.policy=null;if(kind==='selected_social'){initial.channelPolicy!.policy!.channelOrder.push('linkedin');initial.channelPolicy!.policy!.bindings.push({channel:'linkedin',bindingId:'selected-linkedin',bindingDigest:'c'.repeat(64)});}
 expect(renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={initial}>{renderConversation}</AgentControlsPanel>)).toContain('Agent needs setup');
});

it('keeps initial Start agent out of the header so the inline reviewed-brief action owns starting',()=>{const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={{...data,enabled:true}}>{renderConversation}</AgentControlsPanel>);expect(html).not.toContain('Start agent');expect(html).toContain('Agent settings');});

it('asks for missing channel accounts in the chat using the existing editor, without duplicating it in settings',()=>{
 const initial:AgentControlsData={...data,enabled:true,state:{...data.state!,responsibility:{id:'r',state:'ready',revision:1,owner_user_id:'owner'}},channelPolicy:{enabled:true,policy:null,accounts:[]}};
 const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={initial}>{setup=><main aria-label="Chat transcript">{setup}</main>}</AgentControlsPanel>);
 const chat=html.slice(html.indexOf('<main'),html.indexOf('</main>'));
 expect(chat).toContain('Which accounts should I use?');expect(chat).toContain('Channel outreach policy');expect(chat).toContain('Connect an account');
 expect((html.match(/aria-label="Channel outreach policy"/g)||[])).toHaveLength(1);
 expect(html.slice(html.indexOf('<dialog'),html.indexOf('</dialog>'))).not.toContain('aria-label="Channel outreach policy"');
});
it('preserves the conversation while agent controls are loading and progressively discloses advanced settings',()=>{
 const loading=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate">{()=><main>Saved conversation</main>}</AgentControlsPanel>);expect(loading).toContain('Saved conversation');
 const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={data}>{renderConversation}</AgentControlsPanel>);
 expect(html).toMatch(/<details[^>]*aria-label="Advanced agent settings"[^>]*>/);expect(html).not.toMatch(/<details[^>]*aria-label="Advanced agent settings"[^>]*\sopen(?:=|>)/);
});

it('does not ask for accounts on channels outside the saved ready policy',()=>{
 const initial=selectedEmailReadiness();initial.channelPolicy!.enabled=true;initial.channelPolicy!.accounts=[{channel:'email',bindingId:'selected-email',bindingDigest:'a'.repeat(64),label:'Reviewed email'}];
 const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={initial}>{setup=><main>{setup}</main>}</AgentControlsPanel>);
 expect(html.slice(html.indexOf('<main'),html.indexOf('</main>'))).not.toContain('Agent setup request');
});
it('saves inline account choices only after the existing explicit policy submit, without starting or sending',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('document',{visibilityState:'visible'});vi.useFakeTimers();const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 const initial:AgentControlsData={...data,enabled:true,state:{...data.state!,responsibility:{id:'r',state:'ready',revision:1,owner_user_id:'owner'}},channelPolicy:{enabled:true,policy:null,accounts:[{channel:'email',bindingId:'reviewed-account',bindingDigest:'a'.repeat(64),label:'Owned email'}]}};
 const bodies:{url:string;value:Record<string,unknown>}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{if(options?.method==='POST'){bodies.push({url,value:JSON.parse(String(options.body))});return Response.json({result:{revision:1}});}return Response.json(url.endsWith('/execution')?{enabled:true,state:initial.state}:url.endsWith('/handoffs')?initial.inbox:url.endsWith('/authority')?{grants:[]}:url.endsWith('/channel-policy')?initial.channelPolicy:{});}));
 try{await act(async()=>{tree=create(<AgentControlsPanel mandateId="mandate" initial={initial}>{setup=><main>{setup}</main>}</AgentControlsPanel>);});expect(bodies).toHaveLength(0);
  const form=tree!.root.findByProps({'aria-label':'Agent setup request'}).findByProps({'aria-label':'Channel outreach policy'});await act(async()=>{form.props.onSubmit({preventDefault(){}});});
  expect(bodies).toHaveLength(1);expect(bodies[0].url).toBe('/api/mandates/mandate/agent/channel-policy');expect(bodies[0].value).toMatchObject({channelOrder:['email'],bindings:[{channel:'email',bindingId:'reviewed-account'}]});
 }finally{if(tree)await act(async()=>tree!.unmount());vi.useRealTimers();vi.unstubAllGlobals();}
});
it.each([undefined,'extracting'])('puts a saved funding blocker in chat with one budget editor instead of burying it in settings (initial=%s)',async status=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('document',{visibilityState:'visible'});vi.useFakeTimers();const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 const initial:AgentControlsData={...data,enabled:true,demoPreparationEnabled:true,state:{...data.state!,executionMode:'demo',demoContacts:{prepared:0,stale:0,outreachReady:false},responsibility:{id:'r',state:'ready',revision:1,owner_user_id:'owner'}}};
 const fetcher=vi.fn((url:string,options?:RequestInit)=>{void options;return Promise.resolve(Response.json(url.endsWith('/research')?{research:[{operationId:'original-op',revision:3,contextRevision:'a'.repeat(64),name:'research.start',jobId:'original-job',canContinue:true,funding:{ready:false,funded:false,exposure:{calls:'24035',usdMicro:'11000000',perRequestMicro:'1000000',callAdmission:'per_request'},scopes:[{scope:'user',unit:'usd_micro',needed:'11000000',available:'9998966',shortfall:'1001034',windowCoversPhase:true}]}}]}:url.endsWith('/budgets')?{canConfigure:true,accounts:[]}:url.endsWith('/execution')?{enabled:true,state:initial.state}:url.endsWith('/handoffs')?{tasks:[],members:[]}:url.endsWith('/channel-policy')?{enabled:false,policy:null,accounts:[]}:{grants:[]}));});vi.stubGlobal('fetch',fetcher);
 try{await act(async()=>{tree=create(<AgentControlsPanel mandateId="mandate" initial={initial} initialResearchStatus={status}>{setup=><article aria-label="Chat test slot">{setup}</article>}</AgentControlsPanel>);});await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
 const chat=tree!.root.findByProps({'aria-label':'Chat test slot'});expect(chat.findByProps({'aria-label':'Research budget review'})).toBeDefined();expect(chat.findAllByProps({'aria-label':'Agent setup request'})).toHaveLength(0);expect(chat.findAllByType('button').some(button=>button.children.join('')==='Continue saved research')).toBe(true);
 expect(tree!.root.findByType('dialog').findAllByProps({'aria-label':'Research budget review'})).toHaveLength(0);const {AgentBudgetControls}=await import('./agent-budget-controls');expect(tree!.root.findAllByType(AgentBudgetControls)).toHaveLength(1);expect(fetcher.mock.calls.filter(call=>(call[1] as RequestInit|undefined)?.method==='POST')).toHaveLength(0);
 }finally{if(tree)await act(()=>tree!.unmount());vi.useRealTimers();vi.unstubAllGlobals();}
});
it.each(['queued','discovering','crawling','extracting'])('does not present outreach setup as a dependency of initial research (%s)',status=>{
 const initial=selectedEmailReadiness();initial.channelPolicy!.enabled=true;initial.channelPolicy!.policy=null;initial.demoPreparationEnabled=true;initial.state!.executionMode='demo';initial.state!.demoContacts={prepared:0,stale:0,outreachReady:false};
 const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={initial} initialResearchStatus={status}>{setup=><article aria-label="Chat setup">{setup}</article>}</AgentControlsPanel>);
 expect(html).toContain(status==='queued'?'>Research queued<':'>Agent active<');expect(html).not.toContain('>Agent needs setup<');expect(html).not.toContain('aria-label="Agent setup request"');expect(html).toContain('Pause agent');expect(html).toContain('aria-label="Agent settings"');expect(html).toContain('Channel outreach policy');
});
it.each(['complete','cancelled','paused','brief_changed'])('restores outreach setup after the initial research marker is %s',status=>{
 const initial=selectedEmailReadiness();initial.channelPolicy!.enabled=true;initial.channelPolicy!.policy=null;
 const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={initial} initialResearchStatus={status}>{setup=><article>{setup}</article>}</AgentControlsPanel>);expect(html).toContain('aria-label="Agent setup request"');expect(html).toContain('Agent needs setup');
});
it('preserves an explicit paused responsibility and resume control even while an admitted initial root is active',()=>{
 const initial=selectedEmailReadiness();initial.state!.responsibility!.state='paused';
 const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={initial} initialResearchStatus="extracting">{setup=><article>{setup}</article>}</AgentControlsPanel>);expect(html).toContain('>Agent paused<');expect(html).toContain('Resume agent');expect(html).not.toContain('>Agent active<');
});

it.each(['failed','partial'])('prioritises the saved %s research blocker over unrelated outreach setup',status=>{
 const initial=selectedEmailReadiness();initial.channelPolicy!.enabled=true;initial.channelPolicy!.policy=null;
 const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={initial} initialResearchStatus={status}>{setup=><article>{setup}</article>}</AgentControlsPanel>);expect(html).toContain('>Research needs attention<');expect(html).not.toContain('aria-label="Agent setup request"');expect(html).toContain('Pause agent');expect(html).toContain('Channel outreach policy');
});
it('shows a ready cached demo without claiming it ran live research or removing account controls',()=>{
 const initial=selectedEmailReadiness();initial.channelPolicy!.enabled=true;initial.channelPolicy!.policy=null;
 const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={initial} initialResearchStatus="complete" initialResearchSource="cached">{setup=><article>{setup}</article>}</AgentControlsPanel>);expect(html).toContain('>Demo ready<');expect(html).not.toContain('>Agent needs setup<');expect(html).toContain('aria-label="Welcome to Acquire"');expect(html).toContain('Pause agent');
});
it('starts a cached demo in one click using server defaults instead of showing setup forms',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('document',{visibilityState:'visible'});vi.useFakeTimers();const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 const initial=selectedEmailReadiness();initial.channelPolicy!.enabled=true;initial.channelPolicy!.policy=null;initial.state!.executionMode='demo';initial.demoPreparationEnabled=true;
 const posts:{url:string;body:unknown}[]=[],saved=vi.fn().mockResolvedValue(undefined);
 const fetcher=vi.fn((url:string,options?:RequestInit)=>{if(options?.method==='POST'){posts.push({url,body:JSON.parse(options.body as string)});return Promise.resolve(Response.json({result:{status:'proposed'}}));}return Promise.resolve(Response.json(url.endsWith('/execution')?{enabled:true,state:initial.state}:url.endsWith('/handoffs')?initial.inbox:url.endsWith('/readiness')?{configuration:initial.configuration,readiness:initial.readiness}:url.endsWith('/channel-policy')?initial.channelPolicy:{grants:[]}));});vi.stubGlobal('fetch',fetcher);
 try{await act(()=>{tree=create(<AgentControlsPanel mandateId="mandate" initial={initial} initialResearchStatus="complete" initialResearchSource="cached" onActionSaved={saved}>{setup=><article aria-label="Cached demo setup">{setup}</article>}</AgentControlsPanel>);});
 await act(()=>{vi.advanceTimersByTime(3000);});const chat=tree!.root.findByProps({'aria-label':'Cached demo setup'});expect(chat.findAllByType('form')).toHaveLength(0);expect(posts).toHaveLength(0);
 await act(async()=>chat.findAllByType('button').find(button=>button.props.children==='Start')!.props.onClick());
 expect(posts).toEqual([{url:'/api/mandates/mandate/agent/demo',body:{action:'start',requestKey:expect.any(String)}}]);expect(saved).toHaveBeenCalledTimes(1);
 expect(tree!.root.findAllByType('dialog')).toHaveLength(0);expect(tree!.root.findAllByProps({'aria-label':'Agent settings'})).toHaveLength(0);
 }finally{if(tree)await act(()=>tree!.unmount());vi.useRealTimers();vi.unstubAllGlobals();}
});

function preparedDemo():AgentControlsData{
 const value=selectedEmailReadiness();value.state!.executionMode='demo';value.state!.demoContacts={prepared:50,stale:0,outreachReady:true};value.channelPolicy!.enabled=true;value.channelPolicy!.accounts=[{channel:'email',bindingId:'selected-email',bindingDigest:'a'.repeat(64),label:'Simulated email account'}];return value;
}
it('offers the next contact review in chat after demo preparation, without requiring a selected conversation',()=>{
 const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={preparedDemo()} initialResearchStatus="complete" initialResearchSource="cached">{setup=><article aria-label="Chat steps">{setup}</article>}</AgentControlsPanel>);
 const chat=html.slice(html.indexOf('aria-label="Chat steps"'));
 expect(chat).toContain('Review outreach contacts');expect(chat).toContain('50 simulated contacts');expect(chat).toContain('This step does not send messages');expect(chat).not.toContain('Choose explicitly');
});
it('prepares only the exact saved channel-policy contact review when the chat button is clicked',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();vi.stubGlobal('document',{visibilityState:'visible'});const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;const initial=preparedDemo(),posts:{url:string;body:unknown}[]=[],started=vi.fn(),saved=vi.fn().mockResolvedValue(undefined);
 const fetcher=vi.fn((url:string,options?:RequestInit)=>{if(options?.method==='POST'){posts.push({url,body:JSON.parse(options.body as string)});return Promise.resolve(Response.json({result:{id:'selection',status:'proposed'}}));}return Promise.resolve(Response.json(url.endsWith('/execution')?{enabled:true,state:initial.state}:url.endsWith('/handoffs')?initial.inbox:url.endsWith('/targets')?initial.targetOptions??{}:url.endsWith('/readiness')?{configuration:initial.configuration,readiness:initial.readiness}:url.endsWith('/channel-policy')?initial.channelPolicy:{grants:[]}));});vi.stubGlobal('fetch',fetcher);
 try{await act(()=>{tree=create(<AgentControlsPanel mandateId="mandate" initial={initial} initialResearchStatus="complete" initialResearchSource="cached" onConversationActionStart={started} onActionSaved={saved}>{setup=><article aria-label="Chat steps">{setup}</article>}</AgentControlsPanel>);});expect(posts).toHaveLength(0);
 await act(async()=>tree!.root.findByProps({'aria-label':'Chat steps'}).findAllByType('button').find(button=>button.props.children==='Review outreach contacts')!.props.onClick());
 expect(started).toHaveBeenCalledTimes(1);expect(saved).toHaveBeenCalledTimes(1);expect(posts).toEqual([{url:'/api/mandates/mandate/agent/targets',body:{requestKey:expect.any(String),delivery:{mode:'channels',policyRevision:2}}}]);
 }finally{if(tree)await act(()=>tree!.unmount());vi.useRealTimers();vi.unstubAllGlobals();}
});
it.each(['stale','missing_policy','wrong_account'] as const)('keeps contact review out of chat when demo context is %s',kind=>{
 const initial=preparedDemo();if(kind==='stale')initial.state!.demoContacts!.outreachReady=false;if(kind==='missing_policy')initial.channelPolicy!.policy=null;if(kind==='wrong_account')initial.channelPolicy!.accounts=[];
 const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={initial}>{setup=><article aria-label="Chat steps">{setup}</article>}</AgentControlsPanel>);expect(html.slice(html.indexOf('aria-label="Chat steps"'))).not.toContain('Review outreach contacts');
});
it('offers Start for an already prepared demo with no saved policy instead of asking for account confirmation',()=>{
 const initial=preparedDemo();initial.demoPreparationEnabled=true;initial.channelPolicy!.policy=null;initial.state!.demoContacts!.outreachReady=false;
 const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={initial} initialResearchStatus="complete" initialResearchSource="cached">{setup=><article aria-label="Chat steps">{setup}</article>}</AgentControlsPanel>);
 const chat=html.slice(html.indexOf('aria-label="Chat steps"'));expect(chat).toContain('Hi, I’m Acquire');expect(chat).not.toContain('Channel outreach policy');expect(chat).not.toContain('Prepare simulated contacts');expect(chat).not.toContain('Choose outreach accounts');
});

it('keeps later contact batches available in chat after the first group is allocated',()=>{
 const initial=preparedDemo();initial.state!.conversations=[{id:'saved',revision:1,epoch:1,context_revision:'a'.repeat(64),driver_kind:'agent',phase:'active',recipient_email:'lead@example.test',engagement:'cold'}];
 const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={initial}>{setup=><article aria-label="Chat steps">{setup}</article>}</AgentControlsPanel>);
 const chat=html.slice(html.indexOf('aria-label="Chat steps"'));expect(chat).toContain('Review more contacts');expect(chat).toContain('up to 5');expect(chat).toContain('aria-label="Outreach progress"');
});
it('points to an existing pending contact review instead of proposing another batch',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();vi.stubGlobal('document',{visibilityState:'visible'});const fetcher=vi.fn(),show=vi.fn();vi.stubGlobal('fetch',fetcher);const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{await act(()=>{tree=create(<AgentControlsPanel mandateId="mandate" initial={preparedDemo()} pendingContactReview onShowReviews={show}>{setup=><article aria-label="Chat steps">{setup}</article>}</AgentControlsPanel>);});const chat=tree!.root.findByProps({'aria-label':'Chat steps'});expect(chat.findAllByType('button').some(button=>button.props.children==='Review outreach contacts')).toBe(false);await act(()=>chat.findAllByType('button').find(button=>button.props.children==='Review contact selection')!.props.onClick());expect(show).toHaveBeenCalledTimes(1);expect(fetcher).not.toHaveBeenCalled();}finally{if(tree)await act(()=>tree!.unmount());vi.useRealTimers();vi.unstubAllGlobals();}
});
it('places the existing human handoff actions inside chat without duplicating them in the header',()=>{
 const initial=preparedDemo();initial.inbox={members:[],tasks:[{id:'task',revision:1,state:'pending',assignee_user_id:'owner',owner_user_id:'owner',context_revision:'a'.repeat(64),context:{summary:'Review the reply and send the booking link manually'},human_evidence:{},can_reassign:false}]};
 const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={initial}>{setup=><article aria-label="Chat steps">{setup}</article>}</AgentControlsPanel>);
 const chat=html.slice(html.indexOf('aria-label="Chat steps"'));expect(chat).toContain('Record booking link sent');expect(html.match(/aria-label="Human handoff tasks"/g)).toHaveLength(1);expect(html).toContain('Your turn');
});

it.each(['queued','running'] as const)('shows approved contact allocation %s before offering another batch',state=>{
 const initial=preparedDemo();initial.state!.contactAllocation={state,allocated:0,needsReview:0};const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={initial}>{setup=><article aria-label="Chat steps">{setup}</article>}</AgentControlsPanel>);const chat=html.slice(html.indexOf('aria-label="Chat steps"'));expect(chat).toContain('Contact selection approved');expect(chat).not.toContain('Review outreach contacts');expect(chat).toContain('Waiting for saved allocation results');
});
it('does not offer another prepared batch when all prepared demo contacts already have conversations',()=>{
 const initial=preparedDemo();initial.state!.demoContacts!.prepared=1;initial.state!.conversations=[{id:'saved',revision:1,epoch:1,context_revision:'a'.repeat(64),driver_kind:'agent',phase:'active',recipient_email:'lead@example.test',engagement:'cold'}];const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={initial}>{setup=><article aria-label="Chat steps">{setup}</article>}</AgentControlsPanel>);const chat=html.slice(html.indexOf('aria-label="Chat steps"'));expect(chat).toContain('Outreach progress');expect(chat).not.toContain('Review more contacts');
});

it.each(['ready','real','unregistered','paused','not_simulated','not_ready'] as const)('exposes YOLO only for a verified ready simulated mandate (%s)',mode=>{
 const initial=preparedDemo();initial.configuration!.simulation=true;
 if(mode==='real')initial.state!.executionMode='real';if(mode==='unregistered')initial.readiness!.registered=false;if(mode==='paused')initial.state!.responsibility!.state='paused';if(mode==='not_simulated')initial.configuration!.simulation=false;if(mode==='not_ready')initial.state!.demoContacts!.outreachReady=false;
 let allowed:unknown;renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={initial}>{(_setup,options)=>{allowed=options?.allowTestAutoApproval;return null;}}</AgentControlsPanel>);expect(allowed).toBe(mode==='ready');
});

it('keeps demo approval choices in the header, defaults off, and prepares one contact group only when selected',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();vi.stubGlobal('document',{visibilityState:'visible'});
 const{AgentDemoApprovalControls}=await import('./agent-demo-approval-controls');const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 const initial=preparedDemo(),posts:{url:string;body:unknown}[]=[];
 vi.stubGlobal('fetch',vi.fn((url:string,options?:RequestInit)=>{if(options?.method==='POST'){posts.push({url,body:JSON.parse(options.body as string)});return Promise.resolve(Response.json({result:{id:'selection',status:'proposed'}}));}return Promise.resolve(Response.json(url.endsWith('/execution')?{enabled:true,state:initial.state}:url.endsWith('/handoffs')?initial.inbox:url.endsWith('/targets')?initial.targetOptions??{}:url.endsWith('/readiness')?{configuration:initial.configuration,readiness:initial.readiness}:url.endsWith('/channel-policy')?initial.channelPolicy:{grants:[]}));}));
 try{
  await act(()=>{tree=create(<AgentControlsPanel mandateId="mandate" initial={initial}>{()=>null}</AgentControlsPanel>);});
  const control=()=>tree!.root.findByType(AgentDemoApprovalControls);
  expect(Object.values(control().props.value).every(value=>value===false)).toBe(true);expect(posts).toHaveLength(0);
  await act(()=>control().props.onChange({...control().props.value,replies:true}));expect(posts).toHaveLength(0);
  await act(async()=>control().props.onChange({...control().props.value,contacts:true}));
  expect(posts).toEqual([{url:'/api/mandates/mandate/agent/targets',body:{requestKey:expect.any(String),delivery:{mode:'channels',policyRevision:2}}}]);
  await act(()=>control().props.onChange({...control().props.value,initialMessages:true}));expect(posts).toHaveLength(1);
 }finally{if(tree)await act(()=>tree!.unmount());vi.useRealTimers();vi.unstubAllGlobals();}
});

it('disarms selected demo approvals after readiness is lost and does not restore them on recovery',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();vi.stubGlobal('document',{visibilityState:'visible'});
 const{AgentDemoApprovalControls}=await import('./agent-demo-approval-controls');const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 const initial=preparedDemo();let registered=true;
 vi.stubGlobal('fetch',vi.fn((url:string)=>Promise.resolve(Response.json(url.endsWith('/execution')?{enabled:true,state:initial.state}:url.endsWith('/handoffs')?initial.inbox:url.endsWith('/targets')?{}:url.endsWith('/readiness')?{configuration:initial.configuration,readiness:{...initial.readiness,registered}}:url.endsWith('/channel-policy')?initial.channelPolicy:{grants:[]}))));
 try{
  await act(()=>{tree=create(<AgentControlsPanel mandateId="mandate" initial={initial}>{()=>null}</AgentControlsPanel>);});
  await act(()=>{const control=tree!.root.findByType(AgentDemoApprovalControls);control.props.onChange({...control.props.value,replies:true});});
  registered=false;await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});expect(tree!.root.findAllByType(AgentDemoApprovalControls)).toHaveLength(0);
  registered=true;await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});expect(Object.values(tree!.root.findByType(AgentDemoApprovalControls).props.value).every(value=>value===false)).toBe(true);
 }finally{if(tree)await act(()=>tree!.unmount());vi.useRealTimers();vi.unstubAllGlobals();}
});

it.each(['messages','queued','running'] as const)('waits before automatic contact preparation when %s already needs processing',async(kind)=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();vi.stubGlobal('document',{visibilityState:'visible'});const{AgentDemoApprovalControls}=await import('./agent-demo-approval-controls');const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 const initial=preparedDemo();if(kind!=='messages')initial.state!.contactAllocation={state:kind,allocated:0,needsReview:0};const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 try{await act(()=>{tree=create(<AgentControlsPanel mandateId="mandate" initial={initial} pendingMessageReviews={kind==='messages'?1:0}>{()=>null}</AgentControlsPanel>);});await act(()=>{const control=tree!.root.findByType(AgentDemoApprovalControls);control.props.onChange({...control.props.value,contacts:true});});expect(fetcher).not.toHaveBeenCalled();}finally{if(tree)await act(()=>tree!.unmount());vi.useRealTimers();vi.unstubAllGlobals();}
});

it('shows the testing-service dependency in chat without asking users to reconnect unrelated accounts',()=>{
 const initial=selectedEmailReadiness();Object.assign(initial,{demoService:{communicationsApi:'https://127.0.0.1:5991',ready:false,message:'The testing service on 5991 is not ready for this mandate yet. Your saved companies and people are available; simulated outreach has not started.'}});initial.state!.executionMode='demo';initial.state!.demoContacts={prepared:0,stale:0,outreachReady:false};
 const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={initial} onViewCompanies={()=>{}} onViewPeople={()=>{}}>{content=><main>{content}</main>}</AgentControlsPanel>);
 expect(html).toContain('Waiting for the testing service');expect(html).toContain('5991');expect(html).toContain('View companies');expect(html).toContain('View people');expect(html).not.toContain('aria-label="Agent setup request"');
});


it('remembers auto-approve choices after remount while other mandates and owners start Off',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('document',{visibilityState:'hidden'});vi.stubGlobal('fetch',vi.fn());
 const saved=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>saved.set(key,value)});
 const{AgentDemoApprovalControls}=await import('./agent-demo-approval-controls');const{AGENT_DEMO_AUTO_APPROVAL_ALL,AGENT_DEMO_AUTO_APPROVAL_OFF}=await import('./agent-demo-auto-approval');const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 const initial=preparedDemo(),control=()=>tree!.root.findByType(AgentDemoApprovalControls),mount=async(mandate='demo-a',owner='owner')=>{const value=structuredClone(initial);value.state!.responsibility!.owner_user_id=owner;await act(async()=>{tree=create(<AgentControlsPanel mandateId={mandate} initial={value} pendingContactReview>{renderConversation}</AgentControlsPanel>);});await act(async()=>{await Promise.resolve();});},unmount=async()=>{await act(()=>tree!.unmount());tree=undefined;};
 try{
  await mount();expect(control().props.value).toEqual(AGENT_DEMO_AUTO_APPROVAL_OFF);
  await act(()=>control().props.onChange(AGENT_DEMO_AUTO_APPROVAL_ALL));expect([...saved.values()].map(value=>JSON.parse(value).selection)).toContainEqual(AGENT_DEMO_AUTO_APPROVAL_ALL);await unmount();
  await mount();expect(control().props.value).toEqual(AGENT_DEMO_AUTO_APPROVAL_ALL);await unmount();
  await mount('demo-b');expect(control().props.value).toEqual(AGENT_DEMO_AUTO_APPROVAL_OFF);await unmount();
  await mount('demo-a','another-owner');expect(control().props.value).toEqual(AGENT_DEMO_AUTO_APPROVAL_OFF);await unmount();
  await mount();const custom={...AGENT_DEMO_AUTO_APPROVAL_OFF,replies:true};await act(()=>control().props.onChange(custom));await unmount();
  await mount();expect(control().props.value).toEqual(custom);await act(()=>control().props.onChange(AGENT_DEMO_AUTO_APPROVAL_OFF));await unmount();
  await mount();expect(control().props.value).toEqual(AGENT_DEMO_AUTO_APPROVAL_OFF);expect(fetch).not.toHaveBeenCalled();
 }finally{if(tree)await unmount();vi.useRealTimers();vi.unstubAllGlobals();}
});

it('keeps focused named outreach in the conversation slot and off the settings inspector',()=>{
 const initial=preparedDemo();initial.state!.conversations=Array.from({length:6},(_,index)=>({id:`contact-${index}`,revision:1,epoch:1,context_revision:'a'.repeat(64),driver_kind:'agent',phase:'active',recipient_email:`lead-${index}@example.test`,lead_name:`Lead ${index}`,company_name:'Example laboratory',engagement:'cold'}));
 const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={initial} focusedConversationId="contact-5" conversationFocusRequest={2}>{renderConversation}</AgentControlsPanel>);
 const chat=html.slice(html.indexOf('aria-label="Mandate conversation"')),inspector=html.slice(html.indexOf('<dialog'),html.indexOf('</dialog>'));
 expect(chat).toContain('Lead 5');expect(chat).toContain('Example laboratory');expect(chat).toContain('Showing 6–6 of 6');expect(chat).toMatch(/id="agent-conversation-contact-5"[^>]*><details open=""/);
 expect(inspector).not.toContain('aria-label="Outreach progress"');expect(html.match(/aria-label="Outreach progress"/g)).toHaveLength(1);
});

it('routes pending message review to the workspace from the conversation slot without posting',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('document',{visibilityState:'hidden'});vi.stubGlobal('fetch',vi.fn());
 const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;const showReviews=vi.fn();
 try{
  await act(()=>{tree=create(<AgentControlsPanel mandateId="mandate" initial={preparedDemo()} pendingMessageReviews={2} onShowReviews={showReviews}>{renderConversation}</AgentControlsPanel>);});
  const review=tree!.root.findByProps({'aria-label':'Mandate conversation'}).findByProps({'aria-label':'Message approval step'});
  expect(review.findByType('p').children.join('')).toContain('2 message proposals');await act(()=>review.findByType('button').props.onClick());
  expect(showReviews).toHaveBeenCalledTimes(1);expect(fetch).not.toHaveBeenCalled();
 }finally{if(tree)await act(()=>tree!.unmount());vi.unstubAllGlobals();}
});

it('waits at the welcome prompt for a new live mandate and starts the existing research workflow only on Start',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('document',{visibilityState:'visible'});vi.useFakeTimers();const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 const initial=selectedEmailReadiness();initial.state=null;initial.mandateRevision='42';const posts:Record<string,unknown>[]=[];
 vi.stubGlobal('fetch',vi.fn((url:string,options?:RequestInit)=>{if(options?.method==='POST'){posts.push(JSON.parse(options.body as string));return Promise.resolve(Response.json({result:{status:'ready'}}));}return Promise.resolve(Response.json(url.endsWith('/execution')?{enabled:true,state:null,mandateRevision:'42'}:url.endsWith('/handoffs')?initial.inbox:url.endsWith('/readiness')?{configuration:initial.configuration,readiness:initial.readiness}:url.endsWith('/channel-policy')?initial.channelPolicy:{grants:[]}));}));
 try{await act(()=>{tree=create(<AgentControlsPanel mandateId="mandate" mandateDescription="We are seeking a refrigeration business in Queensland." initial={initial} initialResearchStatus="awaiting_start">{setup=><article aria-label="Welcome slot">{setup}</article>}</AgentControlsPanel>);});expect(posts).toHaveLength(0);await act(()=>{vi.advanceTimersByTime(3000);});await act(async()=>tree!.root.findByProps({'aria-label':'Welcome slot'}).findByType('button').props.onClick());expect(posts).toEqual([{action:'start',requestKey:expect.any(String),expectedRevision:0,mandateRevision:'42'}]);
 }finally{if(tree)await act(()=>tree!.unmount());vi.useRealTimers();vi.unstubAllGlobals();}
});

it('shows a plain retry message for an HTML failure response instead of exposing a JSON parser error',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('document',{visibilityState:'visible'});vi.useFakeTimers();const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('<!DOCTYPE html><title>Not found</title>',{status:404,headers:{'Content-Type':'text/html'}})));
 try{await act(()=>{tree=create(<AgentControlsPanel mandateId="mandate" initial={preparedDemo()}>{setup=><article aria-label="Chat steps">{setup}</article>}</AgentControlsPanel>);});await act(async()=>tree!.root.findAllByType('button').find(button=>button.props.children==='Review outreach contacts')!.props.onClick());const text=JSON.stringify(tree!.toJSON());expect(text).toContain('Could not confirm this action. Check saved progress before trying again.');expect(text).not.toContain('Unexpected token');expect(text).not.toContain('DOCTYPE');}finally{if(tree)await act(()=>tree!.unmount());vi.useRealTimers();vi.unstubAllGlobals();}
});

it('keeps All selected without automatically retrying an unchanged saved empty contact selection',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();vi.stubGlobal('document',{visibilityState:'visible'});
 const{AgentDemoApprovalControls}=await import('./agent-demo-approval-controls');const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 const initial=preparedDemo();Object.assign(initial.state!,{contactSelectionEmpty:true});const posts:unknown[]=[];
 vi.stubGlobal('fetch',vi.fn((url:string,options?:RequestInit)=>{if(options?.method==='POST'){posts.push(JSON.parse(options.body as string));return Promise.resolve(Response.json({result:{status:'needs_review'}}));}return Promise.resolve(Response.json(url.endsWith('/execution')?{enabled:true,state:initial.state}:url.endsWith('/handoffs')?initial.inbox:url.endsWith('/targets')?initial.targetOptions??{}:url.endsWith('/readiness')?{configuration:initial.configuration,readiness:initial.readiness}:url.endsWith('/channel-policy')?initial.channelPolicy:{grants:[]}));}));
 try{await act(()=>{tree=create(<AgentControlsPanel mandateId="mandate" initial={initial}>{()=>null}</AgentControlsPanel>);});await act(()=>tree!.root.findByType(AgentDemoApprovalControls).props.onChange(AGENT_DEMO_AUTO_APPROVAL_ALL));
 expect(posts).toEqual([]);expect(tree!.root.findByType(AgentDemoApprovalControls).props.value).toEqual(AGENT_DEMO_AUTO_APPROVAL_ALL);expect(JSON.stringify(tree!.toJSON())).toContain('Needs your review');
 }finally{if(tree)await act(()=>tree!.unmount());vi.useRealTimers();vi.unstubAllGlobals();}
});

it('omits the redundant settings menu in a saved-data demo while keeping primary controls',()=>{
 const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initialResearchSource="cached" initial={{...data,enabled:true,state:{...data.state!,executionMode:'demo',responsibility:{id:'r',state:'ready',revision:1,owner_user_id:'owner'}}}}>{renderConversation}</AgentControlsPanel>);
 expect(html).not.toContain('aria-label="Agent settings"');expect(html).not.toContain('<dialog');expect(html).not.toContain('Configure the current mandate.');expect(html).toContain('Pause agent');
});

it.each([22000,95000,155000])('keeps Start busy through preparation, with bounded safe recovery (duration=%s)',async duration=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('document',{visibilityState:'visible'});vi.useFakeTimers();const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException('signal timed out','TimeoutError')),ms);return controller.signal;});
 const initial=selectedEmailReadiness();initial.demoPreparationEnabled=true;initial.state!.executionMode='demo';initial.state!.demoContacts={prepared:0,stale:0,outreachReady:false};initial.channelPolicy={enabled:true,policy:null,accounts:[]};
 const posts:RequestInit[]=[];
 vi.stubGlobal('fetch',vi.fn((url:string,options?:RequestInit)=>{
  if(options?.method==='POST'){posts.push(options);return new Promise<Response>((resolve,reject)=>{options.signal?.addEventListener('abort',()=>reject(options.signal!.reason),{once:true});setTimeout(()=>resolve(Response.json({result:{status:'proposed'}})),duration);});}
  return Promise.resolve(Response.json(url.endsWith('/execution')?{enabled:true,state:initial.state}:url.endsWith('/handoffs')?initial.inbox:url.endsWith('/readiness')?{configuration:initial.configuration,readiness:initial.readiness}:url.endsWith('/channel-policy')?initial.channelPolicy:{grants:[]}));
 }));
 try{
  await act(()=>{tree=create(<AgentControlsPanel mandateId="mandate" initial={initial} initialResearchSource="cached" initialResearchStatus="complete">{setup=><article aria-label="Start test">{setup}</article>}</AgentControlsPanel>);});
  await act(()=>tree!.root.findAllByType('button').find(b=>b.props.children==='Start')!.props.onClick());
  await act(async()=>{await vi.advanceTimersByTimeAsync(16000);});expect(JSON.stringify(tree!.toJSON())).not.toContain('signal timed out');expect(JSON.stringify(tree!.toJSON())).toContain('Starting…');
  await act(async()=>{await vi.advanceTimersByTimeAsync(6001);});expect(posts).toHaveLength(1);
  if(duration<=95000){await act(async()=>{await vi.advanceTimersByTimeAsync(Math.max(0,duration-22001));});expect(tree!.root.findAllByProps({role:'alert'})).toHaveLength(0);}
  else{await act(async()=>{await vi.advanceTimersByTimeAsync(129000);});expect(JSON.stringify(tree!.toJSON())).toContain('Press Start again to check the same saved request');expect(JSON.stringify(tree!.toJSON())).not.toContain('signal timed out');expect(posts).toHaveLength(1);await act(()=>tree!.root.findAllByType('button').find(b=>b.props.children==='Start')!.props.onClick());expect(posts).toHaveLength(2);expect(posts[0].body).toBe(posts[1].body);}
 }finally{if(tree)await act(()=>tree!.unmount());vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals();}
});

it.each([200,503])('retains the original Start request when the response body is empty (status=%s)',async status=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('document',{visibilityState:'hidden'});const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 const initial=selectedEmailReadiness();initial.demoPreparationEnabled=true;initial.state!.executionMode='demo';initial.state!.demoContacts={prepared:0,stale:0,outreachReady:false};initial.channelPolicy={enabled:true,policy:null,accounts:[]};
 const saved=vi.fn(),fetcher=vi.fn().mockImplementation(async()=>new Response('',{status}));vi.stubGlobal('fetch',fetcher);
 try{await act(()=>{tree=create(<AgentControlsPanel mandateId="mandate" initial={initial} initialResearchSource="cached" initialResearchStatus="complete" onActionSaved={saved}>{setup=><article>{setup}</article>}</AgentControlsPanel>);});
  const start=()=>tree!.root.findAllByType('button').find(b=>b.props.children==='Start')!.props.onClick();await act(async()=>{start();});
  expect(saved).not.toHaveBeenCalled();expect(JSON.stringify(tree!.toJSON())).toContain('Could not confirm this action. Check saved progress before trying again.');expect(JSON.stringify(tree!.toJSON())).not.toContain('Unexpected end');
  expect(fetcher).toHaveBeenCalledOnce();await act(async()=>{start();});expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
 }finally{if(tree)await act(()=>tree!.unmount());vi.unstubAllGlobals();}
});

it('shows research-only results without outreach start or approval controls',()=>{
 const html=renderToStaticMarkup(<AgentControlsPanel mandateId="mandate" initial={{...data,enabled:true,state:{...data.state!,workflowPreset:'live-research-test',workflowExecutionId:'execution'}}}>{renderConversation}</AgentControlsPanel>);
 expect(html).toContain('Research only');expect(html).toContain('No outreach is sent.');expect(html).toContain('View companies');expect(html).toContain('View people');expect(html).not.toContain('Automatic sending');expect(html).not.toContain('Start agent');expect(html).not.toContain('Ready to begin');
});
