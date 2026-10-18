import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {AgentNativeProposalDetails,nativeProposalReviewable} from './agent-native-proposal-details';
import {AgentReviewCards,type AgentReviewBatchView} from './agent-review-cards';
const id='00000000-0000-4000-8000-000000000001',waitId='00000000-0000-4000-8000-000000000002';
const email={id,kind:'email',title:'Introduction',subject:'Acquisition enquiry',body:'Would you consider a conversation? <script>text</script>'};
const input={nativeSequenceDraftVersion:1,sequenceId:id,mode:'update',baseRevision:'12345',name:'Refrigeration owners',definition:{schemaVersion:1,steps:[email,{id:waitId,kind:'wait',title:'Follow-up delay',days:4}]}};
it('renders the exact reviewed draft name, revision, message and wait without authorising execution',()=>{
 const html=renderToStaticMarkup(<AgentNativeProposalDetails name="sequence.prepare" input={input}/>);
 for(const value of ['Refrigeration owners','12345','Introduction','Acquisition enquiry','Would you consider a conversation?','4 days','draft only','does not publish','&lt;script&gt;'])expect(html).toContain(value);
 expect(html).not.toContain('<script>');expect(nativeProposalReviewable('sequence.prepare',input)).toBe(true);
});
it('fails closed on empty, malformed or unversioned draft proposals and disables the review action',()=>{
 for(const invalid of [{},{...input,nativeSequenceDraftVersion:undefined},{...input,name:''},{...input,baseRevision:null},{...input,definition:{schemaVersion:1,steps:[]}},{...input,definition:{schemaVersion:1,steps:[{...email,body:undefined}]}}]){
  expect(nativeProposalReviewable('sequence.prepare',invalid)).toBe(false);
  const batch:AgentReviewBatchView={id:'batch',revision:1,state:'pending',stale:false,manifest:[],operations:[{id:'op',name:'sequence.prepare',revision:1,state:'proposed',input:invalid}]};
  const html=renderToStaticMarkup(<AgentReviewCards batches={[batch]} busy={false} onDecision={vi.fn()} onEdit={vi.fn()}/>);
  expect(html).toContain('Incomplete proposal');expect(html).toMatch(/disabled=""[^>]*>Approve proposal/);
 }
});
it('shows every split branch and disconnected edge, including incomplete builder layouts',()=>{
 const splitId='00000000-0000-4000-8000-000000000003',branchId='00000000-0000-4000-8000-000000000004';
 const definition={schemaVersion:1,steps:[email],splits:[{id:splitId,title:'Alternative wording',afterStepId:waitId,percentage:35,pathA:[{...email,id:waitId,body:'Branch A message'}],pathB:[{...email,id:branchId,body:'Branch B message'}]}],disconnectedConnections:[{source:id,target:'end'}]};
 const html=renderToStaticMarkup(<AgentNativeProposalDetails name="sequence.prepare" input={{...input,mode:'create',baseRevision:null,definition}}/>);
 for(const value of ['New draft','Alternative wording','35%','65%','Branch A message','Branch B message','Disconnected connections',waitId,'end'])expect(html).toContain(value);
 expect(nativeProposalReviewable('sequence.prepare',{...input,mode:'create',baseRevision:null,definition})).toBe(true);
});
