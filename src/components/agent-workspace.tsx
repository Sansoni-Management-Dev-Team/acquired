"use client";

import { randomUuid } from "@/lib/random-uuid";
import {SavedMandateHttpAgent} from "@/lib/agent-http-client";
import {startAgentActivityPolling} from "@/lib/agent-activity-poller";

import Link from 'next/link';
import {AgentControlsPanel} from './agent-controls-panel';
import {AgentGuidancePanel} from './agent-guidance-panel';
import type {AgentGuidanceView} from '@/domain/agent-guidance';
import {AgentReviewCards,type AgentReviewBatchView} from './agent-review-cards';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {createAgentClientSubscription} from '@/lib/agent-client-subscription';
import { HttpAgent } from '@ag-ui/client';
import { ArrowLeft, ArrowUp, LoaderCircle, PanelRight, RefreshCw, Sparkles } from 'lucide-react';
import { agentQuestions, type AgentSnapshot } from '@/domain/agent-mode';

/** Only the alternate route loads the AG-UI client; the main UI keeps its bundle. */
type SavedConversation={threadId?:string;messages:{id:string;role:'user'|'assistant';content:string}[]};
async function fetchReviewBatches(mandateId:string,signal:AbortSignal){
  const response=await fetch(`/api/mandates/${mandateId}/agent/reviews`,{cache:'no-store',signal});
  if(!response.ok)throw new Error('Could not load current review proposals.');
  return (await response.json() as {batches:AgentReviewBatchView[]}).batches;
}
export function AgentWorkspace({ initial, conversation,learningEnabled=false,initialGuidance=[] }: { initial: AgentSnapshot; conversation?:SavedConversation;learningEnabled?:boolean;initialGuidance?:AgentGuidanceView[] }) {
  const agent = useMemo(() => new (conversation?SavedMandateHttpAgent:HttpAgent)({
    threadId:conversation?.threadId,initialMessages:conversation?.messages,
    agentId: 'default', url: `/api/mandates/${initial.mandate.id}/agent`,
    initialState: initial,
  }), [initial,conversation]);
  return <ResearchConversation key={initial.mandate.id} agent={agent} initial={initial} persisted={!!conversation} learningEnabled={learningEnabled} initialGuidance={initialGuidance} />;
}
function ResearchConversation({ agent,initial,persisted,learningEnabled,initialGuidance }: { agent:HttpAgent;initial: AgentSnapshot;persisted:boolean;learningEnabled:boolean;initialGuidance:AgentGuidanceView[] }) {
  const subscription=useMemo(()=>createAgentClientSubscription(agent),[agent]);
  useSyncExternalStore(subscription.subscribe,subscription.getSnapshot,subscription.getServerSnapshot);
  const isReady=true;
  const [snapshot, setSnapshot] = useState(initial);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const activityVersion=useRef(0),transcript=useRef<HTMLDivElement>(null);
  const [updatesPaused,setUpdatesPaused]=useState(false);
  const activeRun=useRef<string|null>(null),stoppedRun=useRef<string|null>(null);
  const [stopping,setStopping]=useState(false);
  const [answering,setAnswering]=useState(false);
  const [error, setError] = useState('');
  const [guidance,setGuidance]=useState(initialGuidance);
  const [memoryDraft,setMemoryDraft]=useState<{sourceMessageId:string;text:string}|undefined>();
  const [contextOpen,setContextOpen]=useState(false);
  const [reviews,setReviews]=useState<AgentReviewBatchView[]>([]);
  const requestId = useRef<string | null>(null);
  const [researchStarted, setResearchStarted] = useState(false);
  async function ask(text: string) {
    if (lock.current || !text.trim() || !isReady) return;
    activityVersion.current++; lock.current = true; setBusy(true); setError(''); setQuestion('');
    const runId=randomUuid();activeRun.current=runId;setAnswering(true);
    try {
      agent.addMessage({ id: randomUuid(), role: 'user', content: text });
      await agent.runAgent({runId});
      setSnapshot(agent.state as AgentSnapshot);
      if(persisted)await refresh();
    }
    catch { if(stoppedRun.current!==runId)setError('Could not finish this turn. Refresh to check its saved state before retrying.'); }
    finally { activeRun.current=null;setAnswering(false);lock.current = false; setBusy(false); }
  }
  async function loadReviews(){
    if(persisted)setReviews(await fetchReviewBatches(initial.mandate.id,AbortSignal.timeout(15000)));
  }
  useEffect(()=>{
    if(!persisted||!isReady)return;
    return startAgentActivityPolling({
      isBusy:()=>lock.current,isVisible:()=>document.visibilityState!=='hidden',version:()=>activityVersion.current,
      load:async signal=>{
        const response=await fetch(`/api/mandates/${initial.mandate.id}/agent/activity`,{cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
        if(!response.ok)throw new Error('Saved activity unavailable');
        return await response.json() as {conversation:SavedConversation;batches:AgentReviewBatchView[];guidance:AgentGuidanceView[]};
      },
      apply:data=>{
        const displayed=agent.messages.filter(message=>message.role==='user'||message.role==='assistant').map(message=>({id:message.id,role:message.role,content:message.content}));
        if(JSON.stringify(displayed)!==JSON.stringify(data.conversation.messages)){
          const view=transcript.current,follow=view&&view.scrollHeight-view.scrollTop-view.clientHeight<100;
          agent.setMessages(data.conversation.messages);
          if(follow)requestAnimationFrame(()=>{if(transcript.current)transcript.current.scrollTop=transcript.current.scrollHeight;});
        }
        setReviews(data.batches);if(learningEnabled)setGuidance(data.guidance);setUpdatesPaused(false);
      },onFailure:failures=>{if(failures>=3)setUpdatesPaused(true);},
    });
  },[agent,initial.mandate.id,isReady,learningEnabled,persisted]);
  async function reviewAction(value:unknown):Promise<boolean>{
    if(lock.current)return false;activityVersion.current++;lock.current=true;setBusy(true);setError('');
    try{
      const response=await fetch(`/api/mandates/${initial.mandate.id}/agent/reviews`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),signal:AbortSignal.timeout(15000)});
      const result=await response.json() as {error?:string};
      if(!response.ok)throw new Error(result.error||'Review unavailable. Refresh before retrying.');
      await refresh();return true;
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not save review. Refresh before retrying.');return false;}
    finally{lock.current=false;setBusy(false);}
  }
  async function guidanceAction(value:unknown):Promise<boolean>{
    if(lock.current)return false;activityVersion.current++;lock.current=true;setBusy(true);setError('');
    try{
      const response=await fetch(`/api/mandates/${initial.mandate.id}/agent/guidance`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),signal:AbortSignal.timeout(15000)});
      const result=await response.json() as {error?:string};if(!response.ok)throw new Error(result.error||'Could not save guidance.');
      await refresh();return true;
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not save guidance. Refresh before retrying.');return false;}
    finally{lock.current=false;setBusy(false);}
  }
  async function refresh() {
    const response = await fetch(`/api/mandates/${initial.mandate.id}/agent`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Status unavailable');
    const data=await response.json() as AgentSnapshot & {conversation?:SavedConversation};
    setSnapshot(data);
    if(data.conversation)agent.setMessages(data.conversation.messages);
    await loadReviews();
    if(learningEnabled){
      const response=await fetch(`/api/mandates/${initial.mandate.id}/agent/guidance`,{cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('Could not refresh saved guidance.');
      setGuidance((await response.json() as {guidance:AgentGuidanceView[]}).guidance);
    }
    setUpdatesPaused(false);
  }
  async function stopTurn(){
    const runId=activeRun.current;if(!runId||stopping)return;
    setStopping(true);setError('');
    try{
      const response=await fetch(`/api/mandates/${initial.mandate.id}/agent`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId}),signal:AbortSignal.timeout(15000)});
      const data=await response.json() as {state?:string;error?:string};
      if(!response.ok)throw new Error(data.error||'Could not stop this turn.');
      stoppedRun.current=runId;agent.abortRun();await refresh();
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not stop. Refresh to check saved state.');}
    finally{setStopping(false);}
  }
  async function refreshStatus() {
    if (lock.current) return;
    activityVersion.current++; lock.current = true; setBusy(true); setError('');
    try { await refresh(); } catch { setError('Could not refresh status. No research was started.'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function startResearch() {
    if (lock.current) return;
    activityVersion.current++; lock.current = true; setBusy(true); setError('');
    try {
      requestId.current ??= randomUuid();
      const response = await fetch(`/api/mandates/${initial.mandate.id}/research`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: requestId.current, fromBrief: true }), signal: AbortSignal.timeout(30000),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok && !(response.status === 409 && data.error?.includes('already running'))) throw new Error(data.error || 'Could not start research.');
      setResearchStarted(true);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start research. Refresh before retrying if the request timed out.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="mx-auto flex h-[calc(100dvh-196px)] min-h-[520px] max-w-[1440px] flex-col gap-4 p-4 sm:px-6 lg:h-[calc(100dvh-88px)] lg:pb-5">
    <header className="flex shrink-0 items-center justify-between gap-3">
      <div className="min-w-0"><Link href={snapshot.links.brief} className="inline-flex min-h-7 items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft size={13} aria-hidden="true"/>Main workspace</Link><div className="flex items-center gap-2"><h1 className="truncate text-xl font-semibold tracking-tight">{snapshot.mandate.name}</h1><span className="hidden shrink-0 items-center gap-1 rounded-full bg-[var(--panel-raised)] px-2 py-1 text-[10px] font-medium text-[var(--muted)] sm:inline-flex"><Sparkles size={11} aria-hidden="true"/>Agent preview</span></div></div>
      <div className="flex shrink-0 items-center gap-1"><Link href={snapshot.links.companies} className="inline-flex min-h-11 items-center rounded-lg px-3 text-xs text-[var(--muted)] hover:bg-[var(--panel-raised)]">Companies</Link><button type="button" onClick={()=>setContextOpen(value=>!value)} aria-expanded={contextOpen} aria-controls="agent-context" className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-xs hover:bg-[var(--panel-raised)] ${contextOpen?'bg-[var(--panel-raised)]':'text-[var(--muted)]'}`}><PanelRight size={16} aria-hidden="true"/>Context{guidance.some(item=>item.state==='proposed')&&<span className="size-1.5 rounded-full bg-[var(--accent)]"><span className="sr-only">Guidance awaiting confirmation</span></span>}</button></div>
    </header>
    <div className={`grid min-h-0 flex-1 gap-4 ${contextOpen?'grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_280px] lg:grid-rows-1':''}`}>
      <section aria-label="Mandate conversation" className="flex min-h-0 flex-col overflow-y-auto overscroll-contain rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-sm">
        {persisted?<AgentControlsPanel onFeedback={learningEnabled?guidanceAction:undefined} mandateId={initial.mandate.id} busy={busy} onBusyChange={value=>{activityVersion.current++;lock.current=value;setBusy(value);}}/>:<div className="border-b border-[var(--border)] px-5 py-3 text-sm font-medium">Mandate conversation</div>}
        <div ref={transcript} role="log" aria-label="Conversation messages" aria-live="polite" className="min-h-[160px] flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto max-w-3xl space-y-6 px-5 py-6 sm:px-8">
            {!agent.messages.length&&<div className="py-10"><Sparkles size={23} className="mb-4 text-[var(--muted)]" aria-hidden="true"/><h2 className="text-lg font-medium">Where shall we start?</h2><p className="mt-2 max-w-md text-sm leading-relaxed text-[var(--muted)]">Review your mandate, check research, or plan the next conversation.</p></div>}
            {agent.messages.filter(m=>m.role==='user'||m.role==='assistant').map(message=><div key={message.id} className={`text-sm ${message.role==='user'?'ml-auto max-w-[85%] rounded-2xl bg-[var(--panel-raised)] px-4 py-3':'max-w-full'}`}><p className="mb-1.5 text-[11px] font-medium text-[var(--muted)]">{message.role==='user'?'You':'Acquire'}</p><p className="whitespace-pre-wrap break-words leading-7">{typeof message.content==='string'?message.content:''}</p>{learningEnabled&&message.role==='user'&&<button type="button" disabled={busy} onClick={()=>{setMemoryDraft({sourceMessageId:message.id,text:typeof message.content==='string'?message.content:''});setContextOpen(true);}} className="mt-1 min-h-9 text-[11px] text-[var(--muted)] underline underline-offset-4 disabled:opacity-40">Use as guidance</button>}</div>)}
          </div>
        </div>
        {reviews.length>0&&<div className="max-h-[28%] shrink-0 overflow-y-auto"><AgentReviewCards onFeedback={learningEnabled?guidanceAction:undefined} mandateId={initial.mandate.id} batches={reviews} busy={busy} onDecision={(batch,decision)=>void reviewAction({action:'decide',batchId:batch.id,revision:batch.revision,items:batch.manifest,decision})} onEdit={(batch,operationId,revision,body)=>reviewAction({action:'edit',batchId:batch.id,operationId,revision,body})}/></div>}
        <div className="shrink-0 border-t border-[var(--border)] px-4 py-3 sm:px-5">
          {persisted&&answering&&<button type="button" disabled={stopping} onClick={()=>void stopTurn()} className="mb-2 min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs disabled:opacity-50">{stopping?'Stopping…':'Stop answer'}</button>}
          <details className="mb-2 text-xs text-[var(--muted)]"><summary className="w-fit cursor-pointer py-1">Suggestions</summary><div className="flex flex-wrap gap-1.5 py-2">{agentQuestions.map(text=><button key={text} type="button" disabled={busy||!isReady} onClick={()=>void ask(text)} className="min-h-9 rounded-full border border-[var(--border)] px-3 text-xs hover:bg-[var(--panel-raised)] disabled:opacity-50">{text}</button>)}</div></details>
          <form onSubmit={event=>{event.preventDefault();void ask(question);}} className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--input)] p-1.5 focus-within:ring-1 focus-within:ring-[var(--muted)]"><label htmlFor="agent-question" className="sr-only">Ask about this mandate</label><input id="agent-question" value={question} onChange={event=>setQuestion(event.target.value)} maxLength={5000} disabled={busy} placeholder="Message Acquire…" className="min-h-10 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none"/><button disabled={busy||!question.trim()||!isReady} aria-label="Send question" className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--on-accent)] disabled:opacity-40">{busy?<LoaderCircle size={18} className="animate-spin motion-reduce:animate-none"/>:<ArrowUp size={18}/>}</button></form>
          <p className="mt-2 text-center text-[10px] text-[var(--muted)]">{persisted?'Saved to this mandate':'Saved for this visit'} · Human approval by default · A human sends the booking link</p>
        </div>
      </section>
      <aside id="agent-context" aria-label="Mandate context" className={`${contextOpen?'block':'hidden'} min-h-0 space-y-4 overflow-y-auto pr-1`}>
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Mandate context</h2><button type="button" onClick={()=>setContextOpen(false)} className="min-h-11 px-2 text-xs text-[var(--muted)]">Close</button></div>
        {learningEnabled&&<AgentGuidancePanel guidance={guidance} busy={busy} draft={memoryDraft} onCloseDraft={()=>setMemoryDraft(undefined)} onAction={guidanceAction}/>}
        <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Research</h3><button type="button" aria-label="Refresh saved research status" disabled={busy} onClick={()=>void refreshStatus()} className="flex size-11 items-center justify-center rounded-lg hover:bg-[var(--panel-raised)] disabled:opacity-40"><RefreshCw size={15}/></button></div><dl className="mt-2 space-y-2.5 text-xs">{[['Jobs recorded',snapshot.research.total],['Queued',snapshot.research.queued],['Active',snapshot.research.active],['Complete',snapshot.research.complete],['Need review',snapshot.research.needsReview],['Cancelled',snapshot.research.cancelled]].map(([label,value])=><div className="flex justify-between" key={label}><dt className="text-[var(--muted)]">{label}</dt><dd>{value}</dd></div>)}</dl><p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">Saved job counts, updated on refresh. These are not company counts.</p><button type="button" onClick={()=>void startResearch()} disabled={busy||(snapshot.research.active+snapshot.research.queued)>0||researchStarted} className="mt-4 min-h-11 w-full rounded-lg bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-accent)] disabled:opacity-40">{researchStarted?'Research requested':snapshot.research.queued?'Research queued':snapshot.research.active?'Research in progress':'Start company research'}</button><p className="mt-2 text-[11px] text-[var(--muted)]">Starting research may incur provider charges.</p><Link href={snapshot.links.companies} className="mt-3 inline-flex min-h-9 items-center text-xs underline underline-offset-4">View company evidence</Link></section>
        <Link href={`/mandates/${initial.mandate.id}/outreach/sequences`} className="inline-flex min-h-11 items-center text-xs text-[var(--muted)] underline underline-offset-4">Open sequence builder</Link>
      </aside>
    </div>
    {updatesPaused&&<p role="status" className="text-xs text-[var(--muted)]">Background updates are temporarily unavailable. Use refresh to catch up.</p>}
    {error && <p role="alert" className="text-sm text-[var(--status-red)]">{error}</p>}
  </div>;
}
