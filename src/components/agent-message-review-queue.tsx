'use client';
import {useEffect,useRef,useState,type ComponentProps} from 'react';
import {AgentReviewCards,type AgentReviewBatchView} from './agent-review-cards';
import {eligibleSimulatedAutoApprovalBatches,type AgentDemoAutoApprovalSelection} from './agent-demo-auto-approval';
import {AgentChatDetails,AgentChatStatus,AgentChatSurface} from './agent-chat-ui';
type Props=Omit<ComponentProps<typeof AgentReviewCards>,'onApproveAll'|'onEditingChange'>&{
 allowTestAutoApproval:boolean;
 automation:AgentDemoAutoApprovalSelection;
 onAutomationStopped:()=>void;
 onAutoApprove:(batches:AgentReviewBatchView[],shouldContinue:(batch:AgentReviewBatchView)=>boolean)=>Promise<boolean>;
 onApproveAll:(batches:AgentReviewBatchView[])=>Promise<boolean>;
};
/** Tab-local consent drives the original exact-manifest review endpoint. Each
 * queued decision is checked again after any earlier decision has completed. */
export function AgentMessageReviewQueue({allowTestAutoApproval,automation,onAutomationStopped,onAutoApprove,onApproveAll,...props}:Props){
 const [editing,setEditing]=useState<string|null>(null),[working,setWorking]=useState(false),[cycle,setCycle]=useState(0);
 const current=useRef({allowTestAutoApproval,automation,batches:props.batches,editing});
 const inFlight=useRef(false),mounted=useRef(true),attempted=useRef(new Set<string>());
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{current.current={allowTestAutoApproval,automation,batches:props.batches,editing};},[allowTestAutoApproval,automation,props.batches,editing]);
 useEffect(()=>{
  if(!allowTestAutoApproval||props.busy||working||inFlight.current||editing)return;
  const next=eligibleSimulatedAutoApprovalBatches(props.batches,automation).filter(batch=>!attempted.current.has(batch.id+':'+batch.revision));
  if(!next.length)return;
  const snapshot=structuredClone(next);
  inFlight.current=true;
  const canContinue=(batch:AgentReviewBatchView)=>{
   const latest=current.current;
   const key=batch.id+':'+batch.revision;
   if(!mounted.current||!latest.allowTestAutoApproval||attempted.current.has(key)||!eligibleSimulatedAutoApprovalBatches(latest.batches,latest.automation,latest.editing).some(value=>JSON.stringify(value)===JSON.stringify(batch)))return false;
   // Mark only the request about to start. Turning Off must not consume queued
   // approvals which were never attempted. A started request is never retried.
   attempted.current.add(key);return true;
  };
  void onAutoApprove(snapshot,canContinue).then(ok=>{if(!ok&&mounted.current)onAutomationStopped();},()=>{if(mounted.current)onAutomationStopped();}).finally(()=>{inFlight.current=false;if(mounted.current)setCycle(value=>value+1);});
 },[allowTestAutoApproval,automation,props.batches,props.busy,working,editing,onAutoApprove,onAutomationStopped,cycle]);
 async function approveAll(batches:AgentReviewBatchView[]){if(inFlight.current)return false;inFlight.current=true;setWorking(true);try{return await onApproveAll(structuredClone(batches));}finally{inFlight.current=false;if(mounted.current)setWorking(false);}}
 const automatic=allowTestAutoApproval?eligibleSimulatedAutoApprovalBatches(props.batches,automation,editing):[];
 const automaticIds=new Set(automatic.map(batch=>batch.id));
 const manual=props.batches.filter(batch=>!automaticIds.has(batch.id));
 const operations=automatic.flatMap(batch=>batch.operations),contacts=operations.filter(op=>op.name==='target.select').reduce((count,op)=>count+(Array.isArray(op.input.selected)?op.input.selected.length:0),0);
 const names=[...new Set(operations.flatMap(op=>op.leadName?[op.leadName]:Array.isArray(op.input.selected)?op.input.selected.flatMap((p:unknown)=>p&&typeof p==='object'&&'name'in p&&typeof p.name==='string'?[p.name]:[]):[]))];
 const people=names.length?` for ${names.slice(0,3).join(', ')}${names.length>3?` and ${names.length-3} others`:''}`:'';
 return <>
  {automatic.length>0&&<AgentChatSurface label="Automatic demo progress"><AgentChatStatus working><p>{contacts?`I’m approving ${contacts} demo contacts${people}.`:`I’m automatically approving ${operations.length===1?'this demo message':`${operations.length} demo messages`}${people}.`}</p><p className="text-xs text-[var(--muted)]">I’ll continue when the saved checks finish.</p></AgentChatStatus><AgentChatDetails summary="View planned steps"><ul className="space-y-2">{operations.map(op=><li key={op.id} id={op.conversationId?'agent-draft-'+op.conversationId:undefined}><p>{op.name==='target.select'?'Prepare conversations':op.name==='linkedin.invitation'?'Approve LinkedIn invitation':`Approve ${op.name.startsWith('whatsapp.')?'WhatsApp':op.name.startsWith('linkedin.')?'LinkedIn':'email'} ${op.name.endsWith('.reply')?'reply':op.name.endsWith('.follow_up')?'follow-up':'message'}`}{op.leadName?` · ${op.leadName}`:''}</p>{typeof op.input.body==='string'&&<p className="whitespace-pre-wrap break-words text-[var(--muted)]">{op.input.body}</p>}</li>)}</ul></AgentChatDetails></AgentChatSurface>}
  <AgentReviewCards {...props} batches={manual} busy={props.busy||working} onEditingChange={setEditing} onApproveAll={approveAll}/>
 </>;
}
