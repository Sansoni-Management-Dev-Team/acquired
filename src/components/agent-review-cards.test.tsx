import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {AgentReviewCards,type AgentReviewBatchView} from './agent-review-cards';
const batch:AgentReviewBatchView={id:'batch',revision:1,state:'pending',stale:false,manifest:[{operationId:'op',revision:1,digest:'a'.repeat(64),contextRevision:'current'}],operations:[{id:'op',name:'email.reply',revision:1,state:'proposed',input:{body:'A factual reply to your question.',subject:'Re: Business enquiry',recipientKey:'email:owner@example.invalid'}}]};
it('shows the exact proposal, recipient and accessible decision controls',()=>{
 const html=renderToStaticMarkup(<AgentReviewCards batches={[batch]} busy={false} onDecision={vi.fn()} onEdit={vi.fn()}/>);
 for(const text of ['A factual reply to your question.','email:owner@example.invalid','Approve proposal','Reject','Edit reply'])expect(html).toContain(text);
 expect(html).not.toContain('Meeting booked');
});
it('blocks stale proposals and explains the need for fresh review',()=>{
 const html=renderToStaticMarkup(<AgentReviewCards batches={[{...batch,stale:true}]} busy={false} onDecision={vi.fn()} onEdit={vi.fn()}/>);
 expect(html).toContain('changed');expect(html).toContain('disabled');
});
it('renders prospect content as text, and labels batch approval with its exact count',()=>{
 const second={...batch.operations[0],id:'op-2',input:{body:'<script>not executable</script>'}};
 const html=renderToStaticMarkup(<AgentReviewCards batches={[{...batch,operations:[...batch.operations,second]}]} busy={false} onDecision={vi.fn()} onEdit={vi.fn()}/>);
 expect(html).toContain('&lt;script&gt;');expect(html).toContain('Approve all 2 proposals');expect(html).not.toContain('<script>not executable');
});
it('keeps an unsaved edit visible and disables saving after background invalidation',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{
  await act(async()=>{tree=create(<AgentReviewCards batches={[batch]} busy={false} onDecision={vi.fn()} onEdit={vi.fn()}/>);});
  await act(async()=>{tree!.root.findAllByType('button').find(button=>button.props.children==='Edit reply')!.props.onClick();});
  await act(async()=>{tree!.root.findByType('textarea').props.onChange({target:{value:'My unsaved contextual answer'}});});
  await act(async()=>{tree!.update(<AgentReviewCards batches={[{...batch,state:'invalidated'}]} busy={false} onDecision={vi.fn()} onEdit={vi.fn()}/>);});
  expect(tree!.root.findByType('textarea').props.value).toBe('My unsaved contextual answer');
  expect(tree!.root.findAllByType('button').find(button=>button.props.children==='Save edit for review')!.props.disabled).toBe(true);
 }finally{if(tree)await act(async()=>tree!.unmount());vi.unstubAllGlobals();}
});
it('shows the exact native research scope, company-only phase and conservative physical request limits before approval',()=>{
 const input={nativeResearchPlanVersion:1,config:{requestId:'saved-job',researchScope:'Commercial refrigeration',geography:'QLD, NSW',targetBusinesses:20},execution:{pipeline:'firmable-company-v1',peopleResearch:false,backgroundResearch:false},providerPolicy:{requestCeilingMicroUsd:'1000000',maxAttempts:{search:6,page:5,ai:5,firmable:60}}};
 const html=renderToStaticMarkup(<AgentReviewCards batches={[{...batch,operations:[{...batch.operations[0],name:'research.start',input}]}]} busy={false} onDecision={vi.fn()} onEdit={vi.fn()}/>);
 for(const text of ['Commercial refrigeration','QLD, NSW','20','Company research only','$1','60','saved-job'])expect(html).toContain(text);
});
it('shows each selected contact, delivery mode and unverified fit rather than labelling target selection a sequence',()=>{
 const input={nativeTargetSelectionVersion:1,delivery:{mode:'local_sink'},selected:[{contactId:'contact',targetId:'target',name:'Synthetic owner',recipient:'owner@example.invalid',qualificationConfirmed:false,fit:[{key:'revenue',status:'unknown',reason:'No verified revenue',sources:[]}]}],notice:'Human approval selects these contacts only'};
 const html=renderToStaticMarkup(<AgentReviewCards batches={[{...batch,operations:[{...batch.operations[0],name:'target.select',input}]}]} busy={false} onDecision={vi.fn()} onEdit={vi.fn()}/>);
 for(const text of ['Contact selection','Synthetic owner','owner@example.invalid','unknown','Local simulation','No verified revenue'])expect(html).toContain(text);expect(html).not.toContain('Sequence proposal');
});
it('disables approval of an empty research or target proposal',()=>{for(const name of ['research.start','target.select']){const html=renderToStaticMarkup(<AgentReviewCards batches={[{...batch,operations:[{...batch.operations[0],name,input:{}}]}]} busy={false} onDecision={vi.fn()} onEdit={vi.fn()}/>);expect(html).toContain('Incomplete proposal');expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Approve proposal/);}});
it('shows exact email-only people enrichment without treating it as outreach authority',()=>{const input={nativePeoplePlanVersion:1,selected:[{targetId:'target',name:'Synthetic refrigeration',firmableId:'company-123',sourceRevision:'a'.repeat(64)}],maxContactsPerCompany:3,includePhones:false,config:{requestId:'people-job'},providerPolicy:{requestCeilingMicroUsd:'1000000',maxAttempts:{firmable:60}}};const html=renderToStaticMarkup(<AgentReviewCards batches={[{...batch,operations:[{...batch.operations[0],name:'research.people',input}]}]} busy={false} onDecision={vi.fn()} onEdit={vi.fn()}/>);for(const text of ['Email contact enrichment only','Synthetic refrigeration','company-123','Phone enrichment is off','3','people-job'])expect(html).toContain(text);});

it('does not approve a blank native publication or enrolment scope',()=>{for(const name of ['sequence.publish','sequence.enrol']){const html=renderToStaticMarkup(<AgentReviewCards batches={[{...batch,operations:[{...batch.operations[0],name,input:{body:'A claim without the exact version'}}]}]} busy={false} onDecision={vi.fn()} onEdit={vi.fn()}/>);expect(html).toMatch(/disabled=""[^>]*>Approve proposal/);}});
it('shows exact applied guidance versions and explains preference-based exclusions before review',()=>{
 const guidanceId='00000000-0000-4000-8000-000000000077',input={nativeTargetSelectionVersion:1,delivery:{mode:'local_sink'},selected:[{contactId:'contact',targetId:'target',name:'Synthetic maintenance owner',recipient:'owner@example.invalid',fit:[],guidanceAssessment:{explanations:[{guidanceId,revision:2,status:'prefer',reason:'Company evidence supports recurring maintenance.'}]}}],excluded:[{contactId:'installation-contact',guidanceAssessment:{explanations:[{guidanceId,revision:2,status:'avoid',reason:'Installation-heavy evidence matches your reviewed avoidance phrase.'}]}}],guidance:{items:[{id:guidanceId,revision:2,input:{text:'Prefer maintenance businesses.'}}]}};
 const html=renderToStaticMarkup(<AgentReviewCards batches={[{...batch,operations:[{...batch.operations[0],name:'target.select',input}]}]} busy={false} onDecision={vi.fn()} onEdit={vi.fn()}/>);
 for(const text of [guidanceId,'Version 2','Prefer maintenance businesses.','Company evidence supports recurring maintenance.','Installation-heavy evidence matches'])expect(html).toContain(text);
});
it('identifies each reviewed social channel and permits bounded exact-body edits instead of calling it a sequence',()=>{for(const channel of ['whatsapp','linkedin'])for(const action of ['initial','reply','follow_up']){const input={body:'Reviewed social message',subject:'',recipientKey:channel+':synthetic-recipient',routeId:'00000000-0000-4000-8000-000000000044'},html=renderToStaticMarkup(<AgentReviewCards batches={[{...batch,operations:[{...batch.operations[0],name:channel+'.'+action,input}]}]} busy={false} onDecision={vi.fn()} onEdit={vi.fn()}/>);expect(html).toContain(channel==='whatsapp'?'WhatsApp':'LinkedIn');expect(html).toContain('Edit reply');expect(html).not.toContain('Sequence proposal');}});
it('does not offer approval for a social draft missing its recorded route',()=>{const html=renderToStaticMarkup(<AgentReviewCards batches={[{...batch,operations:[{...batch.operations[0],name:'whatsapp.reply',input:{body:'No route',subject:'',recipientKey:'whatsapp:synthetic'}}]}]} busy={false} onDecision={vi.fn()} onEdit={vi.fn()}/>);expect(html).toMatch(/disabled=""[^>]*>Approve proposal/);});
it('shows each person with all three exact frozen routes before allocation approval',()=>{const channels=(['email','whatsapp','linkedin'] as const).map((channel,i)=>({channel,bindingId:`00000000-0000-4000-8000-00000000000${i+1}`,bindingDigest:'a'.repeat(64),recipient:{kind:channel==='email'?'email':channel==='whatsapp'?'phone':'linkedin_profile',value:channel==='email'?'synthetic@example.invalid':channel==='whatsapp'?'+9990000000001':'https://www.linkedin.com/in/simulated-person'},identityProof:{kind:'recorded_contact',revision:'1'}})),input={nativeTargetSelectionVersion:1,delivery:{mode:'channels',policyRevision:3},selected:[{contactId:'contact',targetId:'target',name:'[SIMULATED] Owner',qualificationConfirmed:false,fit:[],channels}]},html=renderToStaticMarkup(<AgentReviewCards batches={[{...batch,operations:[{...batch.operations[0],name:'target.select',input}]}]} busy={false} onDecision={vi.fn()} onEdit={vi.fn()}/>);for(const text of ['Email','WhatsApp','LinkedIn','+9990000000001','simulated-person','Policy version 3'])expect(html).toContain(text);expect(html).not.toContain('Incomplete proposal');});
it('shows explicitly unverified manual contacts without inventing company evidence, while rejecting ambiguous source records',()=>{
 const contact={sourceKind:'manual_contact',contactId:'contact',targetId:null,name:'Manual owner',recipient:'owner@example.invalid',qualificationConfirmed:false,fit:[]},input={nativeTargetSelectionVersion:1,delivery:{mode:'local_sink'},selected:[contact]};
 const render=(value:unknown)=>renderToStaticMarkup(<AgentReviewCards batches={[{...batch,operations:[{...batch.operations[0],name:'target.select',input:{...input,selected:[value]}}]}]} busy={false} onDecision={vi.fn()} onEdit={vi.fn()}/>);
 const html=render(contact);expect(html).not.toContain('Incomplete proposal');expect(html).toContain('Operator-entered contact');expect(html).toContain('Company details are unverified');expect(html).not.toContain('Open full company evidence');
 for(const invalid of [{...contact,sourceKind:'researched'},{...contact,qualificationConfirmed:true},{...contact,targetId:'fake-target'}])expect(render(invalid)).toContain('Incomplete proposal');
});
it('separates human-only LinkedIn invitation review from messages and rejects overlong or unguarded notes',()=>{const input={kind:'invitation_linkedin',routeId:'00000000-0000-4000-8000-000000000044',subject:'',body:'A separately reviewed invitation',requiresHumanReview:true},render=(value:Record<string,unknown>)=>renderToStaticMarkup(<AgentReviewCards batches={[{...batch,operations:[{...batch.operations[0],name:'linkedin.invitation',input:value}]}]} busy={false} onDecision={vi.fn()} onEdit={vi.fn()}/>),html=render(input);expect(html).toContain('LinkedIn invitation');expect(html).toContain('Acceptance is not confirmed');expect(html).toContain('Edit reply');expect(html).not.toMatch(/disabled=""[^>]*>Approve proposal/);for(const value of [{...input,body:'x'.repeat(301)},{...input,requiresHumanReview:false},{...input,routeId:null}])expect(render(value)).toMatch(/disabled=""[^>]*>Approve proposal/);});
