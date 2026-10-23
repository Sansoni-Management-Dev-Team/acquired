'use client';
import{useState}from'react';
import type{AgentChannelPolicyInput}from'@/domain/agent-person-channel';
import type{AgentChannelBudget}from'./agent-channel-budget-controls';
type Channel='email'|'whatsapp'|'linkedin';
export type AgentChannelPolicyView={policy:null|{revision:number;channelOrder:Channel[];delaySeconds:number;bindings:{channel:Channel;bindingId:string;bindingDigest:string}[];acceleratedSimulation:boolean};canConfigureBudgets?:boolean;accounts:{channel:Channel;bindingId:string;bindingDigest:string;label:string;isDefault?:boolean;eligibleForNewWork?:boolean;budget?:AgentChannelBudget|null}[]};
const labels={email:'Email',whatsapp:'WhatsApp',linkedin:'LinkedIn'};
export function agentChannelAccountLabel(account:AgentChannelPolicyView['accounts'][number],simulated:boolean,channelAccountCount:number){
 const suffix=` · …${account.bindingId.slice(-6)}`;
 if(simulated)return `Simulated ${account.channel==='email'?'email':labels[account.channel]} account${channelAccountCount>1?suffix:''}`;
 if(!/(?:^|[ ·])physical-[a-f0-9]{32,}(?:$|[ ·])/i.test(account.label))return account.label;
 const platform=account.label.split('·')[1]?.trim().toLowerCase(),provider=({gmail:'Gmail',outlook:'Outlook',imap:'IMAP',whatsapp:'WhatsApp',linkedin:'LinkedIn'} as Record<string,string>)[platform??'']??labels[account.channel];
 return `${provider} account${suffix}`;
}
/** Suggestions are draft UI state only. A saved policy always retains its exact
 * historical bindings; new-work defaults must intersect this mandate's accounts. */
export function initialAgentChannelSelection(value:AgentChannelPolicyView):{channelOrder:Channel[];bindings:Record<string,string>}{
 if(value.policy)return{channelOrder:[...value.policy.channelOrder],bindings:Object.fromEntries(value.policy.bindings.map(b=>[b.channel,b.bindingId]))};
 const available=value.accounts.filter(a=>a.eligibleForNewWork!==false),channelOrder=(['email','whatsapp','linkedin'] as const).filter(channel=>available.some(a=>a.channel===channel)),bindings:Record<string,string>={};
 for(const channel of channelOrder){const accounts=available.filter(a=>a.channel===channel),defaults=accounts.filter(a=>a.isDefault===true),selected=defaults.length===1?defaults[0]:defaults.length===0&&accounts.length===1?accounts[0]:undefined;if(selected)bindings[channel]=selected.bindingId;}
 return{channelOrder:channelOrder.length?channelOrder:['email'],bindings};
}
export function AgentChannelPolicyControls({value,busy,allowAcceleration=false,onSave}:{value:AgentChannelPolicyView;busy:boolean;allowAcceleration?:boolean;onSave:(input:AgentChannelPolicyInput)=>Promise<unknown>}){
 const initial=initialAgentChannelSelection(value),[order,setOrder]=useState<Channel[]>(initial.channelOrder),[bindings,setBindings]=useState<Record<string,string>>(initial.bindings),[delay,setDelay]=useState(value.policy?.delaySeconds??86400),[fast,setFast]=useState(value.policy?.acceleratedSimulation??false),[error,setError]=useState('');
 const selectable=(channel:Channel)=>value.accounts.filter(a=>a.channel===channel&&(a.eligibleForNewWork!==false||value.policy?.bindings.some(b=>b.channel===channel&&b.bindingId===a.bindingId&&b.bindingDigest===a.bindingDigest)));
 const ready=order.length>0&&order.every(c=>selectable(c).some(a=>a.bindingId===bindings[c]))&&(fast?allowAcceleration&&delay>=3&&delay<=60:delay>=86400);
 return <form aria-label="Channel outreach policy" className="space-y-3 rounded-lg border border-[var(--border)] p-3 text-sm" onSubmit={event=>{event.preventDefault();if(busy||!ready)return;setError('');void onSave({expectedRevision:value.policy?.revision??0,channelOrder:order,delaySeconds:delay,bindings:order.map(channel=>({channel,bindingId:bindings[channel]})),acceleratedSimulation:fast}).catch(()=>setError('Policy could not be saved. Refresh before retrying.'));}}>
 <h3 className="font-medium">Outreach channels</h3><p className="text-xs text-[var(--muted)]">Use the selected accounts in this order. A verified reply on any channel cancels future channel attempts. Every message still needs human approval.</p>
 {(['email','whatsapp','linkedin'] as const).map(channel=><div key={channel} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1"><label className="flex min-h-11 w-28 shrink-0 items-center gap-2"><input type="checkbox" checked={order.includes(channel)} disabled={busy} onChange={e=>setOrder(e.target.checked?[...order,channel]:order.filter(c=>c!==channel))}/>{labels[channel]}</label>{order.includes(channel)&&<select aria-label={`${labels[channel]} sender`} value={bindings[channel]??''} disabled={busy} onChange={e=>setBindings({...bindings,[channel]:e.target.value})} className="min-h-11 min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs"><option value="">Choose a recorded account…</option>{selectable(channel).map(a=><option key={a.bindingId} value={a.bindingId}>{agentChannelAccountLabel(a,allowAcceleration,selectable(channel).length)}</option>)}</select>}</div>)}
 <details className="border-t border-[var(--border)] pt-2"><summary className="min-h-9 cursor-pointer py-1 text-xs text-[var(--muted)]">Timing and order · {order.map(c=>labels[c]).join(' → ')} · {fast?`${delay}s`:`${delay/3600}h`} between channels</summary><div className="space-y-3 py-2">
 <ol aria-label="Channel order" className="space-y-1">{order.map((channel,index)=><li key={channel} className="flex items-center gap-2"><span>{index+1}. {labels[channel]}</span><button type="button" disabled={busy||index===0} aria-label={`Move ${labels[channel]} earlier`} onClick={()=>setOrder(order.map((c,i)=>i===index-1?channel:i===index?order[index-1]:c))} className="underline text-xs">Move earlier</button></li>)}</ol>
 {allowAcceleration&&<label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={fast} disabled={busy} onChange={e=>{setFast(e.target.checked);setDelay(e.target.checked?10:86400);}}/>Fast local simulation (synthetic recipients only)</label>}
 <label className="block text-xs">{fast?'Delay between channels (seconds)':'Delay between channels (hours)'}<input type="number" min={fast?3:24} max={fast?60:8784} value={fast?delay:delay/3600} disabled={busy} onChange={e=>setDelay(Number(e.target.value)*(fast?1:3600))} className="ml-2 w-24 rounded border border-[var(--border)] bg-[var(--input)] p-2"/></label>
 </div></details>
 <button type="submit" disabled={busy||!ready} className="min-h-11 rounded-lg border border-[var(--border)] px-3 py-2 disabled:opacity-40">Save reviewed channel policy</button><p className="text-xs text-[var(--muted)]">Saving this policy does not select leads, approve drafts or send messages.</p>{error&&<p role="alert">{error}</p>}
 </form>;
}
