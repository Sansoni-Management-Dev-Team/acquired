'use client';
import {useRef} from 'react';
import {ChevronDown} from 'lucide-react';
import {AGENT_DEMO_AUTO_APPROVAL_OFF,AGENT_DEMO_AUTO_APPROVAL_ALL,type AgentDemoAutoApprovalSelection} from './agent-demo-auto-approval';
import styles from './agent-demo-approval-controls.module.css';

type Props={value:AgentDemoAutoApprovalSelection;onChange:(value:AgentDemoAutoApprovalSelection)=>void;disabled?:boolean;persistent?:boolean};
const steps:{key:keyof AgentDemoAutoApprovalSelection;label:string;accessible:string}[]=[
 {key:'contacts',label:'Contact selection',accessible:'contacts'},
 {key:'initialMessages',label:'First messages',accessible:'first messages'},
 {key:'replies',label:'Replies',accessible:'replies'},
 {key:'followUps',label:'Follow-ups',accessible:'follow-ups'},
 {key:'connectionRequests',label:'Connection requests',accessible:'connection requests'},
 {key:'bookingLinks',label:'Booking-link drafts',accessible:'booking-link drafts'},
 {key:'reviewFlaggedDrafts',label:'Drafts needing attention',accessible:'drafts needing attention'},
];
/** Parent owns saved browser preferences and verified simulator eligibility. This
 * control never reads accounts, changes authority or executes approvals. */
export function AgentDemoApprovalControls({value,onChange,disabled=false,persistent=true}:Props){
 const disclosure=useRef<HTMLDetailsElement>(null),firstStep=useRef<HTMLInputElement>(null),count=steps.filter(step=>value[step.key]).length;
 const mode=count===0?'Off':count===steps.length?'All':'Custom';
 function close(){if(disclosure.current)disclosure.current.open=false;}
 return <details ref={disclosure} className={styles.control}>
  <summary className={styles.summary} aria-label={`Auto-approve: ${mode}`}><span>Auto-approve</span><span className={styles.mode}>{mode}</span><ChevronDown size={14} aria-hidden="true"/></summary>
  <div className={styles.popover}>
   <p className={styles.description}>Simulated recipients only · {persistent?'Saved for this demo in this browser':'Couldn’t save your choice · This page only'}</p>
   <div role="group" aria-label="Auto-approve presets" className={styles.presets}>
    <button type="button" className={styles.preset} aria-pressed={mode==='Off'} disabled={count===0} onClick={()=>{if(count){onChange({...AGENT_DEMO_AUTO_APPROVAL_OFF});close();}}}>Off</button>
    <button type="button" className={styles.preset} aria-pressed={mode==='Custom'} disabled={disabled} onClick={()=>firstStep.current?.focus()}>Custom</button>
    <button type="button" className={styles.preset} aria-pressed={mode==='All'} disabled={disabled||count===steps.length} onClick={()=>{if(!disabled){onChange({...AGENT_DEMO_AUTO_APPROVAL_ALL});close();}}}>All</button>
   </div>
   <fieldset disabled={disabled} className={styles.steps}><legend className={styles.legend}>Choose automatic demo steps</legend>
    {steps.map((step,index)=><label key={step.key} className={styles.step}><input ref={index===0?firstStep:undefined} type="checkbox" aria-label={`Automatically approve demo ${step.accessible}`} checked={value[step.key]} disabled={disabled} onChange={event=>{if(!disabled)onChange({...value,[step.key]:event.target.checked});}}/><span>{step.label}</span></label>)}
   </fieldset>
   <p className={styles.note}>Approvals run while this page is open. Sending booking links and recording meetings still need you. Turning Off stops later approvals; a request already in progress may finish.</p>
  </div>
 </details>;
}
