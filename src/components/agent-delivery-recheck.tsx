'use client';
import{useRef,useState}from'react';
type Conversation={id:string;revision:number;epoch:string|number;context_revision:string;driver_kind:string;phase:string;pause_reason?:string|null;pending_driver?:unknown};
export function AgentDeliveryRecheck({conversation:c,disabled,onCommand}:{conversation:Conversation;disabled:boolean;onCommand:(input:Record<string,unknown>)=>Promise<unknown>}){
 const[working,setWorking]=useState(false),[message,setMessage]=useState('');const lock=useRef(false);
 if(c.driver_kind!=='agent'||c.phase!=='held'||c.pause_reason!=='provider_outcome_unknown'||c.pending_driver)return null;
 async function check(){if(disabled||lock.current)return;lock.current=true;setWorking(true);try{await onCommand({action:'recheck_delivery',conversationId:c.id,revision:c.revision,epoch:Number(c.epoch),contextRevision:c.context_revision});setMessage('Delivery status check requested. Sending remains paused.');}catch{setMessage('Could not confirm this check. Refresh the saved state before trying again.');}finally{setWorking(false);lock.current=false;}}
 return <section aria-label="Delivery status"><p>The original delivery is unconfirmed. Checking its status will not resend the message.</p><button type="button" disabled={disabled||working} className="min-h-11 rounded-lg border border-[var(--border)] px-3" onClick={()=>void check()}>Check delivery status</button>{message&&<p role="status">{message}</p>}</section>;
}
