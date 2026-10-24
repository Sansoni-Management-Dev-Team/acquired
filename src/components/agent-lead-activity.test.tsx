import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {AgentLeadActivity} from './agent-lead-activity';
import type {SavedAgentMessage} from '@/lib/agent-saved-messages';
const lead={id:'person',name:'Zoe Allison',company:'Vet Lab',kind:'reply' as const,reply:{text:'Who is the buyer?',channel:'email' as const,at:'2026-10-21T03:00:00Z'}};
it('shows one latest milestone per lead with their reply, next step and expandable activity',()=>{
 const messages:SavedAgentMessage[]=[{id:'checking',role:'assistant',content:'Checking the send.',lead:{...lead,kind:'status',reply:undefined}},{id:'reply',role:'assistant',content:'Zoe Allison replied.',lead}];
 const html=renderToStaticMarkup(<AgentLeadActivity mandateId="mandate" messages={messages} onReview={vi.fn()}/>);
 expect(html.match(/aria-label="Update for Zoe Allison"/g)).toHaveLength(1);for(const text of ['Vet Lab','Who is the buyer?','View conversation','Activity (2)','reviewing their reply'])expect(html).toContain(text);expect(html).not.toContain('Loading saved conversation');
});
it('gives an unresolved lead one clear review action and never sends or clears a hold on render',()=>{
 const review=vi.fn(),html=renderToStaticMarkup(<AgentLeadActivity mandateId="mandate" messages={[{id:'held',role:'assistant',content:'I couldn’t check Zoe’s conversation.',lead:{...lead,kind:'attention',reply:undefined}}]} onReview={review}/>);
 expect(html).toContain('Review conversation');expect(html).toContain('Review this conversation to continue');expect(review).not.toHaveBeenCalled();
});
it('routes an explicit review to this exact lead without approving anything',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const{create,act}=await import('react-test-renderer');const review=vi.fn();let tree:ReturnType<typeof create>|undefined;
 try{await act(()=>{tree=create(<AgentLeadActivity mandateId="mandate" messages={[{id:'hold',role:'assistant',content:'Sending is paused.',lead:{...lead,kind:'attention'}}]} onReview={review}/>);});await act(()=>tree!.root.findAllByType('button').find(button=>button.props.children==='Review conversation')!.props.onClick());expect(review).toHaveBeenCalledExactlyOnceWith('person');}finally{if(tree)await act(()=>tree!.unmount());vi.unstubAllGlobals();}
});
it('keeps the five latest people visible with older updates available above them',()=>{
 const messages:SavedAgentMessage[]=Array.from({length:7},(_,i)=>({id:String(i),role:'assistant',content:'Draft ready.',lead:{...lead,id:String(i),name:'Lead '+i,kind:'draft'}}));
 const html=renderToStaticMarkup(<AgentLeadActivity mandateId="mandate" messages={messages} onReview={vi.fn()}/>);
 expect(html).toContain('Earlier updates (2 people)');expect(html.indexOf('Lead 0')).toBeLessThan(html.indexOf('Lead 2'));expect(html).not.toMatch(/<details[^>]*\sopen(?:=|>)/);
});

it('describes a named draft without asking for approval when automatic demo messages are on',()=>{
 const html=renderToStaticMarkup(<AgentLeadActivity automaticMessages mandateId="mandate" messages={[{id:'draft',role:'assistant',content:'Your email draft for Zoe Allison is ready to review. It hasn’t been sent.',lead:{...lead,kind:'draft',reply:undefined}}]} onReview={vi.fn()} onReviewDraft={vi.fn()}/>);
 expect(html).toContain('I’ve prepared an email draft for Zoe Allison.');expect(html).toContain('Automatic approval is on');expect(html).toContain('View draft');expect(html).not.toContain('Review draft');expect(html).not.toContain('ready to review');
});
it('does not present an old draft milestone as an outstanding review',()=>{
 const html=renderToStaticMarkup(<AgentLeadActivity pendingDrafts={new Set()} mandateId="mandate" messages={[{id:'draft',role:'assistant',content:'Draft prepared.',lead:{...lead,kind:'draft',reply:undefined}}]} onReview={vi.fn()} onReviewDraft={vi.fn()}/>);
 expect(html).not.toContain('Review draft');expect(html).toContain('latest update');
});
it('shows durable failure references without claiming delivery or inviting blind resend',()=>{
 const html=renderToStaticMarkup(<AgentLeadActivity mandateId="mandate" onReview={vi.fn()} messages={[{id:'failure',role:'assistant',content:'Background work was interrupted.',lead:{...lead,kind:'attention',reply:undefined},failure:{eventId:'event-reference',runId:'run-reference'}}]}/>);
 expect(html).toContain('Failure details');expect(html).toContain('event-reference');expect(html).toContain('run-reference');expect(html).toContain('Delivery outcome has not been confirmed');expect(html).not.toContain('Nothing was sent');expect(html).not.toContain('Retry send');
});
it('retains failure references for earlier and non-person background notices',()=>{
 const failure={eventId:'event-reference',runId:'run-reference'},html=renderToStaticMarkup(<AgentLeadActivity mandateId="mandate" onReview={vi.fn()} messages={[{id:'old',role:'assistant',content:'Interrupted.',lead:{...lead,kind:'attention'},failure},{id:'new',role:'assistant',content:'Later update.',lead},{id:'routine',role:'assistant',content:'Other background interruption.',failure}]}/>);
 expect(html.match(/Failure details/g)).toHaveLength(2);expect(html).toContain('Other background interruption.');
});
