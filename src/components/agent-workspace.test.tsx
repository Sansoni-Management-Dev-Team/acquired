import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('next/link',()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
const activity=vi.hoisted(()=>({apply:undefined as undefined|((value:unknown)=>void),saved:undefined as undefined|(()=>Promise<void>)}));
vi.mock('@/lib/agent-activity-poller',()=>({startAgentActivityPolling:(options:{apply:(value:unknown)=>void})=>{activity.apply=options.apply;return()=>{};}}));
vi.mock('./agent-controls-panel',()=>({AgentControlsPanel:({children,onActionSaved}:{children?:(setup:React.ReactNode)=>React.ReactNode;onActionSaved?:()=>Promise<void>})=>{activity.saved=onActionSaved;return <><div>Agent toolbar</div>{children?.(<div>Inline account setup request</div>)}</>}}));
vi.mock('./company-identity-reviews',()=>({CompanyIdentityReviews:()=>null}));
vi.mock('./agent-review-cards',async importOriginal=>({...await importOriginal<typeof import('./agent-review-cards')>(),AgentReviewCards:()=>null}));
vi.mock('./agent-saved-results',()=>({AgentSavedResults:()=> <div>Saved results inline</div>}));
vi.mock('./agent-brief-review',()=>({AgentBriefReview:()=> <div>Inline saved brief review</div>}));
import {AgentMessageReviewQueue} from './agent-message-review-queue';
import {AgentSavedResults} from './agent-saved-results';
import {AgentControlsPanel} from './agent-controls-panel';
import {AgentWorkspace} from './agent-workspace';
import {SavedMandateHttpAgent} from '@/lib/agent-http-client';
import {CompanyIdentityReviews} from './company-identity-reviews';
import {AgentBriefReview} from './agent-brief-review';
import type {AgentSnapshot} from '@/domain/agent-mode';
const initial:AgentSnapshot={mandate:{id:'56cb6d9e-e530-46a0-a98b-294193049536',name:'A saved mandate',description:'Saved buyer criteria'},scope:'research-only',research:{total:3,queued:0,active:0,complete:3,needsReview:0,cancelled:0},jobs:[],links:{brief:'/saved/brief',companies:'/saved/companies'}};
afterEach(()=>vi.unstubAllGlobals());
it('keeps a typed chat draft when context is opened and closed without starting work',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{
  await act(async()=>{tree=create(<AgentWorkspace initial={initial} conversation={{threadId:'saved-thread',messages:[]}}/>);});
  const input=()=>tree!.root.findByProps({id:'agent-question'});
  await act(async()=>input().props.onChange({target:{value:'Keep this unsent thought'}}));
  const context=()=>tree!.root.findAllByType('button').find(button=>button.props['aria-controls']==='agent-context')!;
  expect(context().props['aria-expanded']).toBe(false);
  await act(async()=>context().props.onClick());expect(context().props['aria-expanded']).toBe(true);
  await act(async()=>context().props.onClick());expect(context().props['aria-expanded']).toBe(false);
  expect(input().props.value).toBe('Keep this unsent thought');expect(fetcher).not.toHaveBeenCalled();
 }finally{if(tree)await act(async()=>tree!.unmount());}
});
it('opens context for an explicit guidance draft without changing the saved conversation',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{
  await act(async()=>{tree=create(<AgentWorkspace initial={initial} learningEnabled conversation={{threadId:'saved-thread',messages:[{id:'message',role:'user',content:'Prefer maintenance businesses'}]}}/>);});
  const useGuidance=tree!.root.findAllByType('button').find(button=>button.props.children==='Use as guidance')!;
  await act(async()=>useGuidance.props.onClick());
  expect(tree!.root.findAllByType('button').find(button=>button.props['aria-controls']==='agent-context')!.props['aria-expanded']).toBe(true);
  expect(tree!.root.findAllByType('textarea').some(textarea=>textarea.props.value==='Prefer maintenance businesses')).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
 }finally{if(tree)await act(async()=>tree!.unmount());}
});
it.each([
 ['assistant','Confirm the saved research brief before company discovery. Confirm subsectors and geography.',true],
 ['assistant','Background work was interrupted. Review its saved operations before retrying; a provider outcome may need reconciliation.',false],
 ['user','Confirm the saved research brief before company discovery. Confirm subsectors and geography.',false],
] as const)('opens inline review only for a controlled assistant brief-review notice (%s)',async(role,content,expected)=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{await act(async()=>{tree=create(<AgentWorkspace initial={initial} conversation={{threadId:'saved-thread',messages:[{id:'notice',role,content}]}}/>);});const buttons=tree!.root.findAllByType('button').filter(a=>a.props.children==='Review brief');expect(buttons).toHaveLength(expected?1:0);expect(tree!.root.findAllByType('a').filter(a=>a.props.children==='Review brief')).toHaveLength(0);expect(fetcher).not.toHaveBeenCalled();}finally{if(tree)await act(async()=>tree!.unmount());}
});

it.each([true,false])('keeps the saved brief review inside the agent conversation only (saved=%s)',async saved=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;try{await act(async()=>{tree=create(<AgentWorkspace initial={initial} {...(saved?{conversation:{threadId:'saved-thread',messages:[]}}:{})}/>);});const cards=tree!.root.findAllByType(AgentBriefReview);expect(cards).toHaveLength(saved?1:0);if(saved){expect(cards[0].props.mandateId).toBe(initial.mandate.id);expect(typeof cards[0].props.onReviewed).toBe('function');expect(tree!.root.findAllByType('button').some(b=>b.props.children==='Start company research')).toBe(false);} }finally{if(tree)await act(async()=>tree!.unmount());}});

it.each([true,false])('mounts the same bounded identity review for saved agent workspaces only (saved=%s)',async saved=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;try{await act(async()=>{tree=create(<AgentWorkspace initial={initial} {...(saved?{conversation:{threadId:'saved-thread',messages:[]}}:{})}/>);});const controls=tree!.root.findAllByType(CompanyIdentityReviews);expect(controls).toHaveLength(saved?1:0);if(saved){expect(controls[0].props.mandateId).toBe(initial.mandate.id);expect(controls[0].props.variant).toBe('agent');}expect(tree!.root.findByProps({id:'agent-question'})).toBeDefined();}finally{if(tree)await act(async()=>tree!.unmount());}});

it('places an agent setup request inside the transcript after the inline brief',async()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('fetch',vi.fn());const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;try{await act(async()=>{tree=create(<AgentWorkspace initial={initial} conversation={{threadId:'saved-thread',messages:[]}}/>);});const transcript=tree!.root.findByProps({'aria-label':'Conversation and reviews'}),content=JSON.stringify(transcript.findAllByType('div').map(node=>typeof node.props.children==='string'?node.props.children:null));expect(content).toContain('Inline account setup request');const nodes=transcript.findAllByType('div').map(node=>node.props.children);expect(nodes.findIndex(value=>value==='Inline saved brief review')).toBeLessThan(nodes.findIndex(value=>value==='Inline account setup request'));}finally{if(tree)await act(async()=>tree!.unmount());}});

it('shows the saved initial research status without a second automatic brief approval or browser launch',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 vi.stubGlobal('requestAnimationFrame',vi.fn());const marked={...initial,initialResearch:{requestId:'server-request',status:'queued'}};
 try{await act(async()=>{tree=create(<AgentWorkspace initial={marked} conversation={{threadId:'saved-thread',messages:[]}}/>);});
 expect(tree!.root.findAllByType(AgentBriefReview)).toHaveLength(0);expect(tree!.root.findByProps({'aria-label':'Initial research status'}).children.join('')).toContain('Research request saved');expect(fetcher).not.toHaveBeenCalled();
 await act(()=>tree!.root.findAllByType('button').find(button=>button.props.children==='Review brief')!.props.onClick());expect(tree!.root.findByType(AgentBriefReview).props.forceOpen).toBe(true);expect(fetcher).not.toHaveBeenCalled();
 }finally{if(tree)await act(()=>tree!.unmount());}
});
it('updates initial research status from saved activity while preserving chat and the closed initial review',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{await act(async()=>{tree=create(<AgentWorkspace initial={{...initial,initialResearch:{requestId:'server-request',status:'queued'}}} conversation={{threadId:'saved-thread',messages:[]}}/>);});
 await act(()=>activity.apply!({conversation:{messages:[]},batches:[],guidance:[],initialResearch:{requestId:'server-request',status:'partial',jobId:'saved-original-job'}}));
 expect(tree!.root.findByProps({'aria-label':'Initial research status'}).children.join('')).toContain('Research needs review');expect(tree!.root.findAllByType(AgentBriefReview)).toHaveLength(0);expect(fetcher).not.toHaveBeenCalled();
 }finally{if(tree)await act(()=>tree!.unmount());}
});

it.each([['paused','Agent paused'],['brief_changed','The research brief changed']])('shows a saved %s initial launch hold without claiming that research is running',async(status,label)=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{await act(async()=>{tree=create(<AgentWorkspace initial={{...initial,initialResearch:{requestId:'server-request',status}}} conversation={{threadId:'saved-thread',messages:[]}}/>);});expect(tree!.root.findByProps({'aria-label':'Initial research status'}).children.join('')).toBe(label);expect(tree!.root.findAllByType(AgentBriefReview)).toHaveLength(0);expect(fetcher).not.toHaveBeenCalled();}finally{if(tree)await act(()=>tree!.unmount());}
});

it('labels a cached demo with saved counts and no live-research claim or automatic brief checklist',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{await act(async()=>{tree=create(<AgentWorkspace initial={{...initial,initialResearch:{requestId:'cached-request',status:'complete',source:'cached',companies:12,people:24}}} conversation={{threadId:'saved-thread',messages:[]}}/>);});expect(tree!.root.findAllByProps({'aria-label':'Initial research status'})).toHaveLength(0);expect(tree!.root.findByType(AgentControlsPanel).props.savedData).toEqual({companies:12,people:24});expect(tree!.root.findAllByType(AgentBriefReview)).toHaveLength(0);expect(fetcher).not.toHaveBeenCalled();
 }finally{if(tree)await act(()=>tree!.unmount());}
});
it('shows the saved research failure reason before outreach setup without starting another request',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{await act(async()=>{tree=create(<AgentWorkspace initial={{...initial,initialResearch:{requestId:'live-request',status:'failed',source:'live',blocker:{code:'provider_unavailable',message:'Research needs a connection review.'}}}} conversation={{threadId:'saved-thread',messages:[]}}/>);});expect(tree!.root.findByProps({'aria-label':'Initial research status'}).children.join('')).toContain('Research needs attention');expect(JSON.stringify(tree!.toJSON())).toContain('Research needs a connection review.');expect(fetcher).not.toHaveBeenCalled();
 }finally{if(tree)await act(()=>tree!.unmount());}
});

it('opens companies and people in chat from the status, header and ready card without navigating or losing the draft',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('requestAnimationFrame',vi.fn());const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{await act(async()=>{tree=create(<AgentWorkspace initial={{...initial,initialResearch:{requestId:'saved',status:'complete',source:'cached'}}} conversation={{threadId:'saved-thread',messages:[]}}/>);});
 await act(()=>tree!.root.findByProps({id:'agent-question'}).props.onChange({target:{value:'Keep my question'}}));
 const companies=tree!.root.findAllByType('button').find(button=>button.props.children==='Companies')!;
 const brief=tree!.root.findAllByType('button').find(button=>button.props.children==='Edit brief')!;
 expect(companies.props.className.split(' ')[0]).toBe(brief.props.className.split(' ')[0]);
 await act(()=>companies.props.onClick());expect(tree!.root.findByType(AgentSavedResults).props.view).toBe('companies');
 await act(()=>tree!.root.findByType(AgentControlsPanel).props.onViewPeople());expect(tree!.root.findByType(AgentSavedResults).props.view).toBe('people');
 await act(()=>tree!.root.findByType(AgentControlsPanel).props.onViewCompanies());expect(tree!.root.findByType(AgentSavedResults).props.view).toBe('companies');
 await act(()=>tree!.root.findByType(AgentSavedResults).props.onClose());expect(tree!.root.findAllByType(AgentSavedResults)).toHaveLength(0);
 expect(tree!.root.findByProps({id:'agent-question'}).props.value).toBe('Keep my question');expect(fetcher).not.toHaveBeenCalled();
 }finally{if(tree)await act(()=>tree!.unmount());}
});

it('keeps the live setup editor before later agent comments without remounting it or losing the chat draft',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('requestAnimationFrame',vi.fn());const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 const messages=[{id:'before-setup',role:'assistant' as const,content:'Choose the outreach accounts.'}];
 try{await act(async()=>{tree=create(<AgentWorkspace initial={initial} conversation={{threadId:'saved-thread',messages}}/>);});
  const editor=tree!.root.findByProps({children:'Inline account setup request'});
  await act(()=>tree!.root.findByProps({id:'agent-question'}).props.onChange({target:{value:'Keep this unsent question'}}));
  await act(()=>tree!.root.findByType(AgentControlsPanel).props.onConversationActionStart());
  const afterSave=[...messages,{id:'after-save',role:'assistant' as const,content:'Your channel choices are saved.'}];
  await act(()=>activity.apply!({conversation:{messages:afterSave},batches:[],guidance:[]}));
  await act(()=>tree!.root.findByType(AgentControlsPanel).props.onConversationActionStart());
  await act(()=>activity.apply!({conversation:{messages:[...afterSave,{id:'after-prepare',role:'assistant',content:'Simulated contacts are ready.'}]},batches:[],guidance:[]}));
  const timeline=tree!.root.findByProps({role:'log'}).findAll(node=>typeof node.type==='string'&&(node.props['data-chat-message-id']||node.props['data-chat-inline-setup']!==undefined)).map(node=>node.props['data-chat-message-id']??'live-setup');
  expect(timeline).toEqual(['before-setup','live-setup','after-save','after-prepare']);
  expect(tree!.root.findByProps({children:'Inline account setup request'})).toBe(editor);
  expect(tree!.root.findByProps({id:'agent-question'}).props.value).toBe('Keep this unsent question');expect(fetcher).not.toHaveBeenCalled();
 }finally{if(tree)await act(()=>tree!.unmount());}
});

it('brings the current action below a new chat answer while retaining the same live editor',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('requestAnimationFrame',vi.fn());
 const earlier={id:'earlier',role:'assistant' as const,content:'Choose accounts.'},saved={id:'saved',role:'assistant' as const,content:'Accounts saved.'},reply={id:'reply',role:'assistant' as const,content:'Review the contacts below.'};
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('/reviews')?{batches:[]}:{...initial,conversation:{messages:[earlier,saved,{id:'question',role:'user',content:'Review outreach contacts'},reply]}}))));
 const run=vi.spyOn(SavedMandateHttpAgent.prototype,'runAgent').mockResolvedValue({} as never);
 const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{await act(()=>{tree=create(<AgentWorkspace initial={initial} conversation={{threadId:'saved-thread',messages:[earlier]}}/>);});
  const editor=tree!.root.findByProps({children:'Inline account setup request'});
  await act(()=>tree!.root.findByType(AgentControlsPanel).props.onConversationActionStart());
  await act(()=>activity.apply!({conversation:{messages:[earlier,saved]},batches:[],guidance:[]}));
  await act(()=>tree!.root.findByProps({id:'agent-question'}).props.onChange({target:{value:'Review outreach contacts'}}));
  await act(()=>tree!.root.findByType('form').props.onSubmit({preventDefault(){}}));
  const timeline=tree!.root.findByProps({role:'log'}).findAll(node=>typeof node.type==='string'&&(node.props['data-chat-message-id']||node.props['data-chat-inline-setup']!==undefined)).map(node=>node.props['data-chat-message-id']??'live-setup');
  expect(timeline).toEqual(['earlier','saved','question','reply','live-setup']);
  expect(tree!.root.findByProps({children:'Inline account setup request'})).toBe(editor);
 }finally{if(tree)await act(()=>tree!.unmount());run.mockRestore();}
});

it('approves only the displayed snapshot in order and stops at the first changed review',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('requestAnimationFrame',vi.fn());
 const batches=Array.from({length:3},(_,i)=>({id:'batch-'+i,revision:1,state:'pending' as const,stale:false,manifest:[{operationId:'op-'+i,revision:1,digest:'a'.repeat(64),contextRevision:'current'}],operations:[{id:'op-'+i,name:'email.reply',revision:1,state:'proposed',input:{body:'A reply.',recipientKey:'email:owner@example.invalid'}}]}));
 const posted:unknown[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{if(options?.method==='POST'){posted.push(JSON.parse(options.body as string));return Response.json(posted.length===2?{error:'Changed'}:{batch:{}},{status:posted.length===2?409:200});}return Response.json(url.endsWith('/activity')?{conversation:{messages:[]},batches:[],guidance:[]}:url.endsWith('/reviews')?{batches:[]}:{...initial,conversation:{messages:[]}});}));
 const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{await act(()=>{tree=create(<AgentWorkspace initial={initial} conversation={{threadId:'saved-thread',messages:[]}}/>);});await act(()=>activity.apply!({conversation:{messages:[]},batches,guidance:[]}));let result:unknown;await act(async()=>{result=await tree!.root.findByType(AgentMessageReviewQueue).props.onApproveAll(batches);});expect(result).toBe(false);expect(posted).toEqual(batches.slice(0,2).map(batch=>({action:'decide',batchId:batch.id,revision:1,items:batch.manifest,decision:'approved'})));expect(tree!.root.findByProps({role:'alert'}).children.join('')).toContain('Approval stopped');
 }finally{if(tree)await act(()=>tree!.unmount());}
});

it('keeps context focused on the brief and hides empty demo diagnostics and sequence navigation',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('fetch',vi.fn());const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{await act(()=>{tree=create(<AgentWorkspace initial={{...initial,initialResearch:{requestId:'cached',source:'cached',status:'complete'}}} learningEnabled conversation={{threadId:'thread',messages:[]}}/>);});
 const text=JSON.stringify(tree!.toJSON());expect(text).toContain('Saved buyer criteria');expect(text).not.toContain('Jobs recorded');expect(text).not.toContain('Open sequence builder');expect(text).not.toContain('Saved guidance (0)');
 }finally{if(tree)await act(()=>tree!.unmount());}
});

it.each([200,503])('keeps a review unconfirmed when its HTTP response is empty, without leaking a parser error (status=%s)',async status=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('requestAnimationFrame',vi.fn());const fetcher=vi.fn().mockImplementation(async()=>new Response('',{status}));vi.stubGlobal('fetch',fetcher);
 const batch={id:'batch',revision:1,state:'pending' as const,stale:false,manifest:[{operationId:'op',revision:1,digest:'a'.repeat(64)}],operations:[{id:'op',name:'email.reply',revision:1,state:'proposed',input:{body:'Saved draft.'}}]};
 const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{await act(()=>{tree=create(<AgentWorkspace initial={initial} conversation={{threadId:'saved-thread',messages:[]}}/>);});await act(()=>activity.apply!({conversation:{messages:[]},batches:[batch],guidance:[]}));let result:unknown;
  await act(async()=>{result=await tree!.root.findByType(AgentMessageReviewQueue).props.onEdit(batch,'op',1,'Keep this human edit.');});
  expect(result).toBe(false);const text=JSON.stringify(tree!.toJSON());expect(text).not.toContain('Unexpected end');expect(text).toContain('Could not confirm the response. Check saved progress before retrying.');expect(fetcher).toHaveBeenCalledOnce();
 }finally{if(tree)await act(()=>tree!.unmount());}
});

it('refreshes saved chat actions through the single bundled activity read',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const fetcher=vi.fn(async(url:string)=>Response.json(url.endsWith('/activity')?{conversation:{messages:[]},batches:[],guidance:[]}:url.endsWith('/reviews')?{batches:[]}:{...initial,conversation:{messages:[]}}));vi.stubGlobal('fetch',fetcher);
 const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;try{await act(()=>{tree=create(<AgentWorkspace initial={initial} conversation={{threadId:'saved-thread',messages:[]}}/>);});fetcher.mockClear();await act(async()=>{await activity.saved!();});expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0][0]).toBe('/api/mandates/'+initial.mandate.id+'/agent/activity');}finally{if(tree)await act(()=>tree!.unmount());}
});


it('keeps the chat footer neutral when workflow policy has not loaded',async()=>{
 const {renderToStaticMarkup}=await import('react-dom/server');
 const html=renderToStaticMarkup(<AgentWorkspace initial={initial} conversation={{threadId:'saved-thread',messages:[]}}/>);
 expect(html).toContain('Saved to this mandate');expect(html).not.toContain('Human approval by default');expect(html).not.toContain('A human sends the booking link');
});
