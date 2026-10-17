'use client';

import {ChannelReviews} from './channel-reviews';

import { randomUuid } from "@/lib/random-uuid";

import { useCallback, useEffect, useRef, useState } from 'react';
import { BriefcaseBusiness, LoaderCircle, Mail, MessageCircle } from 'lucide-react';
import { assertManagementSnapshot, type ConnectionManagementSnapshot, type ManagedConnection } from '../../communications/packages/contracts/src/management';
import type { Platform } from '../../communications/packages/contracts/src';
import {hostedSetupRedirect} from '@/lib/communications-setup-redirect';
const channels = [
 { channel:'email' as const,name:'Email',icon:Mail,description:'Connect an email account.' },
 { channel:'whatsapp' as const,name:'WhatsApp',icon:MessageCircle,description:'Connect your WhatsApp account.' },
 { channel:'linkedin' as const,name:'LinkedIn',icon:BriefcaseBusiness,description:'Connect your LinkedIn account.' },
];
const unavailable=():ConnectionManagementSnapshot=>({available:false,connections:[],checkedAt:new Date().toISOString()});
const pendingSetupKey='acquire.pending-channel-setup';
type PendingSetup={channel:string;before:string[];startedAt:number};
const connectionKey=(c:ManagedConnection)=>`${c.binding.connectionId}:${c.binding.generation}`;
function connectionPending(c:ManagedConnection) {
 return c.status==='connecting'||c.status==='syncing'||c.status==='connected'&&c.readiness.status==='waiting'&&c.readiness.code==='incomplete';
}
function connectionStatus(c:ManagedConnection) {
 if(c.status==='disconnected')return 'Disconnected';if(c.status==='failed')return 'Connection failed';
 if(c.status==='verification_required'||c.readiness.status==='review'&&c.readiness.code==='reconnect')return 'Reconnect required';
 if(c.status==='connecting')return 'Connecting';
 if(c.status==='syncing')return 'Syncing';
 if(c.status==='connected'&&c.readiness.status==='waiting'&&c.readiness.code==='incomplete')return 'Connected · Checking history';
 if(c.status==='connected'&&c.readiness.status==='waiting'&&c.readiness.code==='unavailable')return 'Connected · History check unavailable';
 if(c.readiness.status==='ready')return 'Ready';
 if(c.readiness.status==='waiting')return 'Waiting for reply check';return 'Needs review';
}
export function ChannelConnections({initialSnapshot,setupReturned=false,localSimulatorOrigin}:{initialSnapshot?:ConnectionManagementSnapshot;setupReturned?:boolean;localSimulatorOrigin?:string}={}) {
 const [snapshot,setSnapshot]=useState<ConnectionManagementSnapshot>(initialSnapshot??unavailable),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[emailPlatform,setEmailPlatform]=useState<Platform>('gmail');
 const [noticeChannel,setNoticeChannel]=useState<string>('');
 const [waitingForCallback,setWaitingForCallback]=useState(setupReturned);
 const [callbackChannel,setCallbackChannel]=useState('');
 const pendingSetup=useRef<PendingSetup|null>(null);
 const refreshInFlight=useRef(false);
 const retirementKeys=useRef(new Map<string,string>()),mounted=useRef(true),inFlight=useRef(false);
 const refresh=useCallback(async(signal?:AbortSignal)=>{
  if(signal?.aborted||refreshInFlight.current)return;
  refreshInFlight.current=true;
  try {const response=await fetch('/api/channels/connections',{cache:'no-store',credentials:'same-origin',signal});const value:unknown=await response.json();assertManagementSnapshot(value);if(mounted.current&&!signal?.aborted){
   setSnapshot(value);
   const pending=pendingSetup.current;
   const arrived=pending?value.connections.some(c=>c.binding.channel===pending.channel&&!pending.before.includes(connectionKey(c))):value.connections.length>0;
   if(arrived){setWaitingForCallback(false);setCallbackChannel('');pendingSetup.current=null;try{sessionStorage.removeItem(pendingSetupKey);}catch{}}
  }}
  catch {if(mounted.current&&!signal?.aborted){setSnapshot(unavailable());setNotice('Connections are unavailable right now. Try again later.');}}
  finally{refreshInFlight.current=false;}
 },[]);
 useEffect(()=>{
  try{
   const raw=sessionStorage.getItem(pendingSetupKey);if(!raw)return;
   const saved=JSON.parse(raw) as PendingSetup;
   if(!['email','whatsapp','linkedin'].includes(saved.channel)||!Array.isArray(saved.before)||saved.before.length>1000||!saved.before.every(v=>typeof v==='string'&&v.length<4096)||!Number.isSafeInteger(saved.startedAt)||saved.startedAt>Date.now()||Date.now()-saved.startedAt>900000){sessionStorage.removeItem(pendingSetupKey);return;}
   pendingSetup.current=saved;
   void Promise.resolve().then(()=>{if(mounted.current){setCallbackChannel(saved.channel);setWaitingForCallback(true);}});
  }catch{/* Storage is optional; callback-return feedback still works without it. */}
 },[]);
 useEffect(()=>{mounted.current=true;const controller=new AbortController();void Promise.resolve().then(()=>refresh(controller.signal));return()=>{mounted.current=false;controller.abort();};},[refresh]);
 const pending=waitingForCallback||snapshot.connections.some(connectionPending);
 useEffect(()=>{
  if(!pending)return;
  const controller=new AbortController();
  const interval=setInterval(()=>{if(!inFlight.current)void refresh(controller.signal);},3000);
  const deadline=setTimeout(()=>{clearInterval(interval);setWaitingForCallback(false);setCallbackChannel('');pendingSetup.current=null;try{sessionStorage.removeItem(pendingSetupKey);}catch{}},120000);
  return()=>{clearInterval(interval);clearTimeout(deadline);controller.abort();};
 },[pending,refresh]);
 const manage=useCallback(async(input:Record<string,unknown>)=>{
  if(inFlight.current)return;inFlight.current=true;setBusy(true);
  const channel=input.channel??(input.binding as {channel?:string}|undefined)?.channel;
  setNoticeChannel(typeof channel==='string'?channel:'');
  setNotice(input.action==='setup'?'Opening account connection…':'');
  try {
   const response=await fetch('/api/channels/connections',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(input)});
   if(!response.ok)throw Error('Unavailable');const result=await response.json();if(!mounted.current)return;
   if(input.action==='setup'&&result.status==='redirect'){
    const redirect=hostedSetupRedirect(result,{localSimulatorOrigin,pageOrigin:window.location.origin});
    try{sessionStorage.setItem(pendingSetupKey,JSON.stringify({channel,before:snapshot.connections.map(connectionKey),startedAt:Date.now()}));}catch{}
    window.location.assign(redirect);return;
   }
   if(input.action==='setup'){
    setNotice('Account setup could not be opened. Please try again.');
    await refresh();return;
   }
   if(result.status==='unknown')setNotice('The result could not be confirmed. Check the connection before trying another action.');
   else if(result.status==='review'||result.status==='rejected'||result.status==='unavailable')setNotice('This connection needs attention before the action can complete.');
   else if(input.action==='default')setNotice('Connection selected for new work.');
   else if(input.action==='disconnect'&&result.status==='disconnected')setNotice('Connection disconnected.');
   await refresh();
  }catch {if(mounted.current)setNotice('The connection action could not be confirmed. Refresh to check its status.');}
  finally{inFlight.current=false;if(mounted.current)setBusy(false);}
 },[refresh,snapshot.connections,localSimulatorOrigin]);
 function disconnect(c:ManagedConnection) {
  if(!window.confirm(`Disconnect ${c.label}? Existing work will pause until its connection is resolved.`))return;
  const identity=JSON.stringify(c.binding);let key=retirementKeys.current.get(identity);if(!key){key=randomUuid();retirementKeys.current.set(identity,key);}
  void manage({action:'disconnect',binding:c.binding,key});
 }
 return <section aria-labelledby="channel-connections-heading" className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6">
  <div className="flex items-center justify-between gap-3"><h2 id="channel-connections-heading" className="text-lg font-semibold">Channel connections</h2><button type="button" disabled={busy} onClick={()=>void refresh()} className="text-sm underline disabled:opacity-50">Refresh</button></div>
  <p id="channel-setup-availability" className="mt-2 text-sm text-[var(--muted)]">{snapshot.available?'Connect accounts and choose which connection to use for new work.':'Account setup is not available yet.'}</p>
  {waitingForCallback&&!callbackChannel&&<p role="status" aria-live="polite" className="mt-3 flex items-center gap-2 text-sm"><LoaderCircle size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none"/>Waiting for account connection…</p>}
  {notice&&!noticeChannel&&<p role="status" aria-live="polite" className="mt-3 text-sm">{notice}</p>}
  <div className="mt-5 space-y-3">{channels.map(({channel,name,icon:Icon,description})=><div key={channel} className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 sm:p-5">
   <div className="flex flex-wrap items-center gap-3"><div className="flex size-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel)]"><Icon size={20} aria-hidden="true"/></div><h3 className="flex-1 font-semibold">{name}</h3>{!snapshot.available&&<span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)]">Setup unavailable</span>}</div>
   <p className="mt-3 text-sm text-[var(--muted)]">{description}</p>
   {snapshot.connections.filter(c=>c.binding.channel===channel).map(c=><div key={c.binding.connectionId} aria-busy={connectionPending(c)} className="mt-4 border-t border-[var(--border)] pt-3">
    <p className="break-words text-sm font-medium">{c.label}</p><p className="mt-1 flex items-center gap-2 text-sm text-[var(--muted)]">{connectionPending(c)&&<LoaderCircle size={16} role="img" aria-label={`${name} connection pending`} className="animate-spin motion-reduce:animate-none"/>}{connectionStatus(c)}{c.isDefault?' · Default for new work':''}</p>
    <div className="mt-3 flex flex-wrap gap-3 text-sm">
     <button disabled={busy} type="button" onClick={()=>void manage({action:'status',binding:c.binding})} className="underline disabled:opacity-50">Check status</button>
     {!c.isDefault&&c.status!=='disconnected'&&<button disabled={busy} type="button" onClick={()=>void manage({action:'default',binding:c.binding})} className="underline disabled:opacity-50">Use for new work</button>}
     {(c.status==='disconnected'||c.status==='failed'||c.status==='verification_required')&&<button disabled={busy} type="button" onClick={()=>void manage({action:'setup',channel,platform:c.binding.platform,reconnectBinding:c.binding})} className="underline disabled:opacity-50">Reconnect</button>}
     {c.status!=='disconnected'&&<button disabled={busy} type="button" onClick={()=>disconnect(c)} className="underline disabled:opacity-50">Disconnect</button>}
    </div>
   </div>)}
   {channel==='email'&&snapshot.available&&<label className="mt-4 block text-sm">Email provider<select aria-label="Email provider" value={emailPlatform} disabled={busy} onChange={e=>setEmailPlatform(e.target.value as Platform)} className="ml-3 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2"><option value="gmail">Gmail</option><option value="outlook">Outlook</option><option value="imap" disabled>IMAP unavailable</option></select></label>}
   <button type="button" disabled={!snapshot.available||busy} aria-describedby="channel-setup-availability" onClick={()=>void manage({action:'setup',channel,platform:channel==='email'?emailPlatform:channel})} className="mt-4 inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50">{busy&&noticeChannel===channel?<><LoaderCircle size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none"/>Connecting…</>:<>Connect {name}</>}</button>
   {notice&&noticeChannel===channel&&<p role="status" aria-live="polite" className="mt-3 text-sm">{notice}</p>}
   {waitingForCallback&&callbackChannel===channel&&<p role="status" aria-live="polite" className="mt-3 flex items-center gap-2 text-sm"><LoaderCircle size={16} role="img" aria-label={`${name} connection pending`} className="animate-spin motion-reduce:animate-none"/>Waiting for account connection…</p>}
  </div>)}</div>
  <ChannelReviews/>
 </section>;
}
