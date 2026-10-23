import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {AgentOutreachProgress,type AgentOutreachConversation} from './agent-outreach-progress';

const conversation:AgentOutreachConversation={id:'one',revision:1,epoch:'1',context_revision:'a'.repeat(64),driver_kind:'agent',phase:'active',engagement:'engaged',recipient_email:'lead@example.invalid'};
function props(conversations:AgentOutreachConversation[]=[conversation]){return {conversations,busy:false,running:true,onHandover:vi.fn(),onHeldControl:vi.fn(),onCommand:vi.fn().mockResolvedValue({}),canHandBack:()=>false};}
it('shows workflow progress without claiming that active or submitted means sent or delivered',()=>{
 const html=renderToStaticMarkup(<AgentOutreachProgress {...props([{...conversation,channels:[{id:'route',channel:'email',state:'submitted',recipient:conversation.recipient_email,nextAllowedAt:null,historyComplete:true}]}])}/>);
 expect(html).toContain('Outreach progress');expect(html).toContain('Active conversation');expect(html).toContain('Submitted');expect(html).not.toContain('>Sent<');expect(html).not.toContain('>Delivered<');expect(html).toContain('Message approval and delivery are separate');
});
it('summarizes stopped, held, handoff and completed work without exposing raw diagnostic strings',()=>{
 const html=renderToStaticMarkup(<AgentOutreachProgress {...props([{...conversation,phase:'held',pause_reason:'SECRET_PROVIDER_ERROR'},{...conversation,id:'two',engagement:'stopped'},{...conversation,id:'three',engagement:'handoff',driver_kind:'human',phase:'paused'},{...conversation,id:'four',phase:'complete'}])}/>);
 for(const label of ['Needs review','Stopped','Human handoff','Complete'])expect(html).toContain(label);expect(html).not.toContain('SECRET_PROVIDER_ERROR');expect(html).not.toContain('Take over');
});
it('renders no empty progress section',()=>expect(renderToStaticMarkup(<AgentOutreachProgress {...props([])}/>)).toBe(''));
it('pages five contacts at a time and never fetches or acts just from viewing progress',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 const values=Array.from({length:12},(_,index)=>({...conversation,id:String(index),recipient_email:`lead-${index}@example.invalid`})),input=props(values);
 try{await act(()=>{tree=create(<AgentOutreachProgress {...input}/>)});expect(tree!.root.findAllByProps({'data-outreach-conversation':true})).toHaveLength(5);expect(JSON.stringify(tree!.toJSON())).toContain('lead-0@example.invalid');expect(JSON.stringify(tree!.toJSON())).not.toContain('lead-5@example.invalid');
  await act(()=>tree!.root.findByProps({'aria-label':'Next outreach contacts'}).props.onClick());expect(JSON.stringify(tree!.toJSON())).toContain('lead-5@example.invalid');expect(JSON.stringify(tree!.toJSON())).not.toContain('lead-0@example.invalid');
  await act(()=>tree!.root.findByProps({'aria-label':'Next outreach contacts'}).props.onClick());expect(tree!.root.findAllByProps({'data-outreach-conversation':true})).toHaveLength(2);expect(tree!.root.findByProps({'aria-label':'Next outreach contacts'}).props.disabled).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();expect(input.onHandover).not.toHaveBeenCalled();expect(input.onHeldControl).not.toHaveBeenCalled();expect(input.onCommand).not.toHaveBeenCalled();
 }finally{if(tree)await act(()=>tree!.unmount());vi.unstubAllGlobals();}
});
it('uses exact current conversation state for explicit ownership and held recovery actions',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;const input=props();
 try{await act(()=>{tree=create(<AgentOutreachProgress {...input}/>)});await act(()=>tree!.root.findAllByType('button').find(b=>b.props.children==='Take over')!.props.onClick());expect(input.onHandover).toHaveBeenCalledWith(conversation,'human');
  const held={...conversation,revision:3,phase:'held',pause_reason:'provider_no_submission_confirmed',history_complete:true};await act(()=>tree!.update(<AgentOutreachProgress {...input} conversations={[held]}/>));
  await act(()=>tree!.root.findAllByType('button').find(b=>b.props.children==='Check previous messages')!.props.onClick());expect(input.onHeldControl).toHaveBeenCalledWith(held,'refresh_held_history');
  await act(()=>tree!.root.findAllByType('button').find(b=>b.props.children==='Resume agent')!.props.onClick());expect(input.onHeldControl).toHaveBeenCalledWith(held,'resume_held');
 }finally{if(tree)await act(()=>tree!.unmount());vi.unstubAllGlobals();}
});
it('keeps unknown sends, stopped people, active handoffs and paused supervision from an unsafe resume',()=>{
 const unknown=renderToStaticMarkup(<AgentOutreachProgress {...props([{...conversation,phase:'held',pause_reason:'unknown_provider_outcome'}])}/>);expect(unknown).not.toContain('Resume agent');expect(unknown).not.toContain('Move to agent');
 const unresolved=renderToStaticMarkup(<AgentOutreachProgress {...props([{...conversation,driver_kind:'human',phase:'paused',engagement:'handoff'}])}/>);expect(unresolved).not.toContain('Move to agent');
 const stopped=renderToStaticMarkup(<AgentOutreachProgress {...props([{...conversation,driver_kind:'human',engagement:'stopped'}])} canHandBack={()=>true}/>);expect(stopped).not.toContain('Move to agent');
 const paused=renderToStaticMarkup(<AgentOutreachProgress {...props([{...conversation,phase:'held',pause_reason:'provider_receipt_pending_history',history_complete:true}])} running={false}/>);expect(paused).toMatch(/<button[^>]*disabled=""[^>]*>Resume agent<\/button>/);
 const resolved=renderToStaticMarkup(<AgentOutreachProgress {...props([{...conversation,driver_kind:'human',phase:'paused',engagement:'handoff'}])} canHandBack={()=>true}/>);expect(resolved).toContain('Move to agent');
});
it('loads saved conversation history only after explicitly opening a person, with its current context revision',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const fetcher=vi.fn().mockResolvedValue(Response.json({history:{complete:true,observedAt:'2026-10-18T12:01:00Z',messages:[{id:'inbound',direction:'inbound',text:'Can we schedule a call?',at:'2026-10-18T12:00:00Z'}]}}));vi.stubGlobal('fetch',fetcher);const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{await act(()=>{tree=create(<AgentOutreachProgress {...props()} mandateId="mandate"/>)});expect(fetcher).not.toHaveBeenCalled();const details=()=>tree!.root.findAllByType('details')[0];await act(()=>details().props.onToggle({currentTarget:{open:true}}));expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/mandates/mandate/agent/operations?conversationId=one&include=history',expect.objectContaining({method:'GET',cache:'no-store'}));expect(JSON.stringify(tree!.toJSON())).toContain('Can we schedule a call?');await act(()=>details().props.onToggle({currentTarget:{open:false}}));expect(tree!.root.findAllByProps({'aria-label':'Saved conversation'})).toHaveLength(0);
 }finally{if(tree)await act(()=>tree!.unmount());vi.unstubAllGlobals();}
});

it('shows the saved lead name first while keeping the exact address in the conversation details',()=>{
 const html=renderToStaticMarkup(<AgentOutreachProgress {...props([{...conversation,lead_name:'Saishabi Sharma'}])}/>);expect(html).toContain('Saishabi Sharma');expect(html).toContain(conversation.recipient_email);expect(html.indexOf('Saishabi Sharma')).toBeLessThan(html.indexOf(conversation.recipient_email));
});

it('makes the next step clear for pending history, ready drafts and unanswered messages',()=>{
 const html=renderToStaticMarkup(<AgentOutreachProgress {...props([{...conversation,id:'checking',lead_name:'Natalie',pause_reason:'channel_history_pending',history_complete:false},{...conversation,id:'draft',lead_name:'Zoe',draft_pending:true},{...conversation,id:'waiting',lead_name:'Meg',last_message_direction:'outbound',next_wakeup_at:'2030-01-08T00:00:00Z'}])}/>);
 for(const text of ['Checking conversation','Review draft','Waiting for a reply','Next check'])expect(html).toContain(text);
});
it('opens an explicitly requested lead on the right page without trapping later pagination',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;const values=Array.from({length:12},(_,i)=>({...conversation,id:String(i),lead_name:'Lead '+i})),input=props(values);
 try{await act(()=>{tree=create(<AgentOutreachProgress {...input} focusedConversationId="8" conversationFocusRequest={1}/>);});expect(tree!.root.findByProps({id:'agent-conversation-8'}).findAllByType('details')[0].props.open).toBe(true);expect(JSON.stringify(tree!.toJSON())).not.toContain('Lead 0');await act(()=>tree!.root.findByProps({'aria-label':'Next outreach contacts'}).props.onClick());expect(JSON.stringify(tree!.toJSON())).toContain('Lead 10');await act(()=>tree!.update(<AgentOutreachProgress {...input} focusedConversationId="8" conversationFocusRequest={2}/>));expect(JSON.stringify(tree!.toJSON())).toContain('Lead 8');expect(input.onCommand).not.toHaveBeenCalled();}finally{if(tree)await act(()=>tree!.unmount());vi.unstubAllGlobals();}
});

it('offers an explicit named conversation action and opens the entire message thread with one click',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const fetcher=vi.fn().mockResolvedValue(Response.json({history:{complete:true,observedAt:'2026-10-18T12:01:00Z',messages:[{id:'sent',direction:'outbound',text:'Hello Cedric',at:'2026-10-18T12:00:00Z',channel:'email'}]}}));vi.stubGlobal('fetch',fetcher);const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;const input=props([{...conversation,lead_name:'Cedric Chaminade'}]);
 try{await act(()=>{tree=create(<AgentOutreachProgress {...input} mandateId="mandate"/>)});const row=tree!.root.findByProps({id:'agent-conversation-one'}),details=row.findAllByType('details')[0];expect(row.findAllByType('summary')[0].props['aria-label']).toBe('View conversation with Cedric Chaminade');
 await act(()=>details.props.onToggle({currentTarget:{open:true}}));const saved=row.findByProps({'aria-label':'Saved conversation'});expect(saved.findAllByType('details')).toHaveLength(0);expect(JSON.stringify(tree!.toJSON())).toContain('Hello Cedric');expect(input.onCommand).not.toHaveBeenCalled();expect(input.onHandover).not.toHaveBeenCalled();
 }finally{if(tree)await act(()=>tree!.unmount());vi.unstubAllGlobals();}
});

it('lets the user close a focused conversation and reopen it only on a new focus request',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;const input=props([{...conversation,lead_name:'Cedric'}]);
 try{await act(()=>{tree=create(<AgentOutreachProgress {...input} focusedConversationId="one" conversationFocusRequest={1}/>)});const details=()=>tree!.root.findByProps({id:'agent-conversation-one'}).findAllByType('details')[0];expect(details().props.open).toBe(true);await act(()=>details().props.onToggle({currentTarget:{open:false}}));expect(details().props.open).not.toBe(true);expect(details().findAllByType('summary')[0].props['aria-label']).toBe('View conversation with Cedric');await act(()=>tree!.update(<AgentOutreachProgress {...input} focusedConversationId="one" conversationFocusRequest={2}/>));expect(details().props.open).toBe(true);
 }finally{if(tree)await act(()=>tree!.unmount());vi.unstubAllGlobals();}
});
