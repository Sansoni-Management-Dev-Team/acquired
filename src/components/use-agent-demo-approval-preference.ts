'use client';

import {useEffect,useState} from 'react';
import {AGENT_DEMO_AUTO_APPROVAL_OFF,type AgentDemoAutoApprovalSelection} from './agent-demo-auto-approval';

const steps=Object.keys(AGENT_DEMO_AUTO_APPROVAL_OFF) as (keyof AgentDemoAutoApprovalSelection)[];

/** Browser preference only. Restoring it never bypasses the caller's current
 * simulator/readiness checks or the server's exact approval commands. */
export function useAgentDemoApprovalPreference(mandateId:string,ownerUserId:string|undefined,allowed:boolean){
 const key=ownerUserId?`acquire:demo-auto-approve:v1:${encodeURIComponent(ownerUserId)}:${encodeURIComponent(mandateId)}`:null;
 const [saved,setSaved]=useState<{key:string|null;selection:AgentDemoAutoApprovalSelection}>({key:null,selection:AGENT_DEMO_AUTO_APPROVAL_OFF});
 const [persistent,setPersistent]=useState(true);
 useEffect(()=>{
  let cancelled=false,storageAvailable=true;
  // Readiness gates execution immediately through the return value below. A
  // temporary failed check must not rewrite the owner's saved preference.
  // Browser storage is hydrated after mount; server and first client render stay Off.
  queueMicrotask(()=>{
   if(cancelled)return;
   let selection:AgentDemoAutoApprovalSelection=AGENT_DEMO_AUTO_APPROVAL_OFF;
   try{
    if(key&&allowed){
     const raw=localStorage.getItem(key);
     if(raw){
      try{
       const value=JSON.parse(raw);
       if(value?.version===1&&value.selection&&typeof value.selection==='object'&&!Array.isArray(value.selection)&&Object.keys(value.selection).length===steps.length&&steps.every(step=>typeof value.selection[step]==='boolean'))selection=Object.fromEntries(steps.map(step=>[step,value.selection[step]])) as AgentDemoAutoApprovalSelection;
      }catch{/* Invalid saved preferences start Off. */}
     }
    }
   }catch{storageAvailable=false;}
   setPersistent(storageAvailable);setSaved({key,selection});
  });
  return()=>{cancelled=true;};
 },[key,allowed]);
 function setSelection(value:AgentDemoAutoApprovalSelection){
  const selection=allowed?{...value}:{...AGENT_DEMO_AUTO_APPROVAL_OFF};
  try{if(key)localStorage.setItem(key,JSON.stringify({version:1,selection}));setPersistent(Boolean(key));}catch{setPersistent(false);}
  setSaved({key,selection});
 }
 return {selection:allowed&&saved.key===key?saved.selection:AGENT_DEMO_AUTO_APPROVAL_OFF,setSelection,persistent};
}
