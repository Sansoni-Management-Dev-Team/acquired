import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {AgentMessageReviewQueue} from './agent-message-review-queue';
import {AgentReviewCards,type AgentReviewBatchView} from './agent-review-cards';
const off={contacts:false,initialMessages:false,replies:false,followUps:false,connectionRequests:false,bookingLinks:false,reviewFlaggedDrafts:false};
const replies={...off,replies:true};
const batch:AgentReviewBatchView={id:'batch',revision:1,state:'pending',stale:false,manifest:[{operationId:'op',revision:1,digest:'a'.repeat(64),contextRevision:'c'.repeat(64)}],operations:[{id:'op',name:'email.reply',revision:1,state:'proposed',input:{contextRevision:'c'.repeat(64),bindingDigest:'b'.repeat(64),body:'A reply.',recipientKey:'email:lead-001@agent-real-research-demos.leads.acquire.test'}}]};
afterEach(()=>vi.unstubAllGlobals());
it('keeps automation controls out of reviews and approves only after the header selection is enabled',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const{create,act}=await import('react-test-renderer'),approve=vi.fn<(batches:AgentReviewBatchView[],guard?:(batch:AgentReviewBatchView)=>boolean)=>Promise<boolean>>(async(batches,guard)=>batches.every(batch=>!guard||guard(batch)));let tree:ReturnType<typeof create>|undefined;
 const props={batches:[batch],busy:false,allowTestAutoApproval:true,onApproveAll:approve,onAutoApprove:approve,onAutomationStopped:vi.fn(),onDecision:vi.fn(),onEdit:vi.fn()};
 try{await act(()=>{tree=create(<AgentMessageReviewQueue {...props} automation={off}/>);});expect(approve).not.toHaveBeenCalled();expect(tree!.root.findByType(AgentReviewCards).props.autoApproval).toBeUndefined();await act(()=>tree!.update(<AgentMessageReviewQueue {...props} automation={replies}/>));expect(approve).toHaveBeenCalledTimes(1);expect(approve.mock.calls[0][0]).toEqual([batch]);}finally{if(tree)await act(()=>tree!.unmount());}
});
it('never approves outside verified simulation or to a real recipient',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const{create,act}=await import('react-test-renderer'),approve=vi.fn<(batches:AgentReviewBatchView[],guard?:(batch:AgentReviewBatchView)=>boolean)=>Promise<boolean>>(async(batches,guard)=>batches.every(batch=>!guard||guard(batch)));let tree:ReturnType<typeof create>|undefined;
 const props={batches:[batch],busy:false,onApproveAll:approve,onAutoApprove:approve,onAutomationStopped:vi.fn(),onDecision:vi.fn(),onEdit:vi.fn(),automation:replies};
 try{await act(()=>{tree=create(<AgentMessageReviewQueue {...props} allowTestAutoApproval={false}/>);});expect(approve).not.toHaveBeenCalled();await act(()=>tree!.update(<AgentMessageReviewQueue {...props} batches={[{...batch,operations:[{...batch.operations[0],input:{...batch.operations[0].input,recipientKey:'email:person@real.example'}}]}]} allowTestAutoApproval/>));expect(approve).not.toHaveBeenCalled();}finally{if(tree)await act(()=>tree!.unmount());}
});
it('disarms after failure without retrying the same decision',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const{create,act}=await import('react-test-renderer'),approve=vi.fn<(batches:AgentReviewBatchView[],guard?:(batch:AgentReviewBatchView)=>boolean)=>Promise<boolean>>(async(batches,guard)=>{batches.every(batch=>!guard||guard(batch));return false;}),stop=vi.fn();let tree:ReturnType<typeof create>|undefined;
 const props={batches:[batch],busy:false,allowTestAutoApproval:true,onApproveAll:approve,onAutoApprove:approve,onAutomationStopped:stop,onDecision:vi.fn(),onEdit:vi.fn(),automation:replies};
 try{await act(()=>{tree=create(<AgentMessageReviewQueue {...props}/>);});expect(approve).toHaveBeenCalledTimes(1);expect(stop).toHaveBeenCalledTimes(1);await act(()=>tree!.update(<AgentMessageReviewQueue {...props} batches={[...props.batches]}/>));expect(approve).toHaveBeenCalledTimes(1);}finally{if(tree)await act(()=>tree!.unmount());}
});
it('stops queued decisions immediately when turned off, changed, unmounted or readiness is lost',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const{create,act}=await import('react-test-renderer');let done!:(ok:boolean)=>void;let check!:(batch:AgentReviewBatchView)=>boolean;const approve=vi.fn(async(_b:AgentReviewBatchView[],guard:(batch:AgentReviewBatchView)=>boolean)=>{check=guard;return new Promise<boolean>(resolve=>{done=resolve;});});let tree:ReturnType<typeof create>|undefined;
 const props={batches:[batch],busy:false,allowTestAutoApproval:true,onApproveAll:vi.fn(),onAutoApprove:approve,onAutomationStopped:vi.fn(),onDecision:vi.fn(),onEdit:vi.fn(),automation:replies};
 try{await act(()=>{tree=create(<AgentMessageReviewQueue {...props}/>);});expect(check(batch)).toBe(true);await act(()=>tree!.update(<AgentMessageReviewQueue {...props} automation={off}/>));expect(check(batch)).toBe(false);await act(()=>tree!.update(<AgentMessageReviewQueue {...props} allowTestAutoApproval={false}/>));expect(check(batch)).toBe(false);await act(()=>tree!.unmount());tree=undefined;expect(check(batch)).toBe(false);await act(()=>done(true));}finally{if(tree)await act(()=>tree!.unmount());}
});
it('never approves an unsaved edited draft',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const{create,act}=await import('react-test-renderer'),approve=vi.fn<(batches:AgentReviewBatchView[],guard?:(batch:AgentReviewBatchView)=>boolean)=>Promise<boolean>>(async(batches,guard)=>batches.every(batch=>!guard||guard(batch)));let tree:ReturnType<typeof create>|undefined;
 const props={batches:[batch],busy:false,allowTestAutoApproval:true,onApproveAll:vi.fn(),onAutoApprove:approve,onAutomationStopped:vi.fn(),onDecision:vi.fn(),onEdit:vi.fn()};
 try{await act(()=>{tree=create(<AgentMessageReviewQueue {...props} automation={off}/>);});await act(()=>tree!.root.findByType(AgentReviewCards).props.onEditingChange(batch.id));await act(()=>tree!.update(<AgentMessageReviewQueue {...props} automation={replies}/>));expect(approve).not.toHaveBeenCalled();}finally{if(tree)await act(()=>tree!.unmount());}
});

it('can resume never-started approvals after Off without repeating an already-started request',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const{create,act}=await import('react-test-renderer');let release!:()=>void;const firstDone=new Promise<void>(resolve=>{release=resolve;}),posted:string[]=[];
 const second={...batch,id:'second',manifest:[{...batch.manifest[0],operationId:'second-op'}],operations:[{...batch.operations[0],id:'second-op'}]};
 const approve=vi.fn(async(batches:AgentReviewBatchView[],guard:(batch:AgentReviewBatchView)=>boolean)=>{for(const item of batches){if(!guard(item))return false;posted.push(item.id);if(item.id===batch.id)await firstDone;}return true;});let tree:ReturnType<typeof create>|undefined;
 const props={batches:[batch,second],busy:false,allowTestAutoApproval:true,onApproveAll:vi.fn(),onAutoApprove:approve,onAutomationStopped:vi.fn(),onDecision:vi.fn(),onEdit:vi.fn()};
 try{
  await act(()=>{tree=create(<AgentMessageReviewQueue {...props} automation={replies}/>);});expect(posted).toEqual(['batch']);
  await act(()=>tree!.update(<AgentMessageReviewQueue {...props} automation={off}/>));await act(async()=>{release();await firstDone;});expect(posted).toEqual(['batch']);
  await act(()=>tree!.update(<AgentMessageReviewQueue {...props} automation={replies}/>));expect(posted).toEqual(['batch','second']);
 }finally{if(tree)await act(()=>tree!.unmount());}
});

it('announces automatic work without asking for approval and drains a new batch arriving during the previous refresh',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const{create,act}=await import('react-test-renderer');let release!:(ok:boolean)=>void;
 const next={...batch,id:'second',manifest:[{...batch.manifest[0],operationId:'next'}],operations:[{...batch.operations[0],id:'next',leadName:'Ryan Fox'}]};
 const approve=vi.fn(async(batches:AgentReviewBatchView[],guard:(batch:AgentReviewBatchView)=>boolean)=>{if(!batches.every(guard))return false;if(batches[0].id===batch.id)return new Promise<boolean>(resolve=>{release=resolve;});return true;});let tree:ReturnType<typeof create>|undefined;
 const props={batches:[batch],busy:false,allowTestAutoApproval:true,onApproveAll:vi.fn(),onAutoApprove:approve,onAutomationStopped:vi.fn(),onDecision:vi.fn(),onEdit:vi.fn(),automation:replies};
 try{await act(()=>{tree=create(<AgentMessageReviewQueue {...props}/>);});
  expect(tree!.root.findAllByType('button').some(b=>b.props.children==='Approve proposal')).toBe(false);
  expect(JSON.stringify(tree!.toJSON())).toContain('automatic');
  await act(()=>tree!.update(<AgentMessageReviewQueue {...props} batches={[next]}/>));
  await act(()=>release(true));expect(approve).toHaveBeenCalledTimes(2);expect(approve.mock.calls[1][0]).toEqual([next]);
 }finally{if(tree)await act(()=>tree!.unmount());}
});
