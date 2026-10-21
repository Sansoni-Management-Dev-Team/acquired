import {formattedAgentAccountLabel} from '@/domain/agent-account-label';
import {AgentChatDetails,AgentChatIdentity,type AgentChatPersonView} from './agent-chat-ui';
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const text=(v:unknown)=>typeof v==='string'?v:'';
const channel=(v:unknown)=>v==='whatsapp'?'WhatsApp':v==='linkedin'?'LinkedIn':'Email';
function sourceLink(value:unknown){try{const url=new URL(text(value));return ['http:','https:'].includes(url.protocol)?url.href:undefined;}catch{return undefined;}}
/** Display metadata is separate from the sealed selection; decisions use its exact original manifest. */
export function AgentContactSelection({input,mandateId,people=[]}:{input:Record<string,unknown>;mandateId?:string;people?:AgentChatPersonView[]}){
 const selected=(input.selected as unknown[]).map(record),unconfirmed=selected.filter(person=>person.qualificationConfirmed!==true).length;
 return <div>
  <p className="text-sm text-[var(--muted)]">{record(input.delivery).mode==='local_sink'?'Local simulation · ':''}{selected.length===1?'One contact is selected.':`${selected.length} contacts are selected.`} A reply stops further outreach to that person.</p>
  {unconfirmed===selected.length&&<p className="mt-1 text-xs text-[var(--muted)]">Their fit with your mandate hasn’t been confirmed.</p>}
  <ul aria-label="Selected contacts" className="mt-2 divide-y divide-[var(--border)]">
   {selected.map(person=>{const id=text(person.contactId),metadata=people.find(p=>p.id===id),routes=Array.isArray(person.channels)?person.channels.map(record):[];return <li key={id} className="py-3">
    <AgentChatIdentity name={text(person.name)||metadata?.name||'Contact'} company={metadata?.company} role={metadata?.role}/>
    <p className="mt-1 text-xs text-[var(--muted)]">{routes.length?routes.map(route=>channel(route.channel)).join(' · '):'Email'}{unconfirmed>0&&unconfirmed<selected.length?` · ${person.qualificationConfirmed===true?'Fit confirmed':'Fit not confirmed'}`:''}</p>
    <AgentChatDetails summary="Details">
     {person.sourceKind==='manual_contact'&&<p>Manually added contact. Company details haven’t been checked.</p>}
     {routes.length?<ul aria-label="Recorded contact routes" className="space-y-2">{routes.map(route=><li key={text(route.channel)}><span className="font-medium">{channel(route.channel)}</span> · {text(record(route.recipient).value)}<p className="text-xs text-[var(--muted)]">{formattedAgentAccountLabel(route.senderLabel,text(route.channel))}</p></li>)}</ul>:<p className="break-words">{text(person.recipient)}</p>}
     <div className="mt-3"><p className="font-medium">Mandate fit evidence</p><ul className="mt-1 space-y-2">{!(person.fit as unknown[]).length&&<li>No supporting fit evidence is available yet.</li>}{(person.fit as unknown[]).map(raw=>{const row=record(raw);return <li key={text(row.key)}><p>{text(row.key)}: {text(row.status)}</p><p className="text-xs text-[var(--muted)]">{text(row.reason)}</p>{Array.isArray(row.sources)&&row.sources.map((value,i)=>{const href=sourceLink(value);return href?<a key={i} href={href} target="_blank" rel="noreferrer noopener" className="mr-3 underline underline-offset-4">Source</a>:null;})}</li>;})}</ul></div>
     {mandateId&&/^[a-f0-9-]{36}$/i.test(text(person.targetId))&&<a href={`/mandates/${mandateId}/targets/${text(person.targetId)}`} className="mt-2 inline-flex min-h-11 items-center underline underline-offset-4">Open full company evidence</a>}
    </AgentChatDetails>
   </li>;})}
  </ul>
 </div>;
}
