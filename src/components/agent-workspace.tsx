"use client";
import {isAgentMessageReviewOperation} from '@/domain/agent-operation-classifications';

import {isAgentResearchBriefReviewNotice} from '@/domain/agent-research-notice';

import { randomUuid } from "@/lib/random-uuid";
import {SavedMandateHttpAgent} from "@/lib/agent-http-client";
import {startAgentActivityPolling} from "@/lib/agent-activity-poller";

import Link from 'next/link';
import actionStyles from './agent-chat-actions.module.css';
import {AgentChatMessage,AgentChatDetails} from './agent-chat-ui';
import {messagesAroundInlineAction} from './agent-chat-timeline';
import {groupAgentChatNotices} from './agent-chat-notices';
import {AgentLeadActivity} from './agent-lead-activity';
import type {SavedAgentMessage} from '@/lib/agent-saved-messages';
import {AgentSavedResults} from './agent-saved-results';
import {AgentMessageReviewQueue} from './agent-message-review-queue';
import {AgentControlsPanel,type AgentConversationOptions} from './agent-controls-panel';
import {eligibleSimulatedAutoApprovalBatches,AGENT_DEMO_AUTO_APPROVAL_ALL,AGENT_DEMO_AUTO_APPROVAL_OFF} from './agent-demo-auto-approval';
import {AgentBriefReview} from './agent-brief-review';
import {CompanyIdentityReviews} from './company-identity-reviews';
import {AgentGuidancePanel} from './agent-guidance-panel';
import type {AgentGuidanceView} from '@/domain/agent-guidance';
import {eligibleAgentMessageReviewBatches,type AgentReviewBatchView} from './agent-review-cards';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {createAgentClientSubscription} from '@/lib/agent-client-subscription';
import { HttpAgent } from '@ag-ui/client';
import { ArrowLeft, ArrowUp, LoaderCircle, PanelRight, Sparkles } from 'lucide-react';
import type { AgentSnapshot } from '@/domain/agent-mode';

/** Only the alternate route loads the AG-UI client; the main UI keeps its bundle. */
type SavedConversation={threadId?:string;messages:SavedAgentMessage[]};
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
  const activityVersion=useRef(0),transcript=useRef<HTMLDivElement>(null),reviewAnchor=useRef<HTMLDivElement>(null),briefAnchor=useRef<HTMLDivElement>(null);
  const latestMessage=useRef<HTMLDivElement>(null);
  function revealLatestMessage(){requestAnimationFrame(()=>latestMessage.current?.scrollIntoView({block:'start',behavior:'auto'}));}
  const [briefReviewOpen,setBriefReviewOpen]=useState(false);
  const [setupBoundary,setSetupBoundary]=useState<string[]|null>(null);
  const [resultsView,setResultsView]=useState<'companies'|'people'|null>(null);
  const [focusedConversation,setFocusedConversation]=useState<{id:string;request:number}|null>(null);
  function reviewConversation(id:string){setFocusedConversation(current=>({id,request:(current?.request??0)+1}));requestAnimationFrame(()=>document.getElementById('agent-conversation-'+id)?.scrollIntoView({block:'center',behavior:'smooth'}));}
  const resultsAnchor=useRef<HTMLDivElement>(null);
  function showResults(view:'companies'|'people'){setResultsView(view);requestAnimationFrame(()=>resultsAnchor.current?.scrollIntoView({block:'start',behavior:'auto'}));}
  const [updatesPaused,setUpdatesPaused]=useState(false);
  const activeRun=useRef<string|null>(null),stoppedRun=useRef<string|null>(null);
  const [stopping,setStopping]=useState(false);
  const [answering,setAnswering]=useState(false);
  const [error, setError] = useState('');
  const [guidance,setGuidance]=useState(initialGuidance);
  const [memoryDraft,setMemoryDraft]=useState<{sourceMessageId:string;text:string}|undefined>();
  const [contextOpen,setContextOpen]=useState(false);
  const [reviews,setReviews]=useState<AgentReviewBatchView[]>([]);
  async function ask(text: string) {
    if (lock.current || !text.trim() || !isReady) return;
    // A new question starts a new conversational step. Keep the live action
    // after its answer; only action-generated replies stay below the old card.
    setSetupBoundary(null);
    activityVersion.current++; lock.current = true; setBusy(true); setError(''); setQuestion('');
    const runId=randomUuid();activeRun.current=runId;setAnswering(true);
    try {
      agent.addMessage({ id: randomUuid(), role: 'user', content: text });
      revealLatestMessage();
      await agent.runAgent({runId});
      setSnapshot(agent.state as AgentSnapshot);
      if(persisted)await refresh();
      revealLatestMessage();
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
        return await response.json() as {conversation:SavedConversation;batches:AgentReviewBatchView[];guidance:AgentGuidanceView[];initialResearch?:AgentSnapshot['initialResearch']};
      },
      apply:data=>{
        const displayed=agent.messages.filter(message=>message.role==='user'||message.role==='assistant').map(message=>({id:message.id,role:message.role,content:message.content,...('noticeKind' in message?{noticeKind:message.noticeKind}:{}),...('lead' in message?{lead:message.lead}:{})}));
        if(JSON.stringify(displayed)!==JSON.stringify(data.conversation.messages)){
          const view=transcript.current,follow=view&&view.scrollHeight-view.scrollTop-view.clientHeight<100;
          agent.setMessages(data.conversation.messages);
          if(follow)revealLatestMessage();
        }
        if(data.initialResearch)setSnapshot(current=>({...current,initialResearch:data.initialResearch}));
        setReviews(data.batches);if(learningEnabled)setGuidance(data.guidance);setUpdatesPaused(false);
      },onFailure:failures=>{if(failures>=3)setUpdatesPaused(true);},
    });
  },[agent,initial.mandate.id,isReady,learningEnabled,persisted]);
  async function submitReview(value:unknown){
    const response=await fetch(`/api/mandates/${initial.mandate.id}/agent/reviews`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),signal:AbortSignal.timeout(15000)});
    const result=await response.json() as {error?:string};
    if(!response.ok)throw new Error(result.error||'This review changed. Refresh before trying again.');
  }
  async function approveMessageBatches(batches:AgentReviewBatchView[],shouldContinue:(batch:AgentReviewBatchView)=>boolean=()=>true,simulated=false):Promise<boolean>{
    if(lock.current)return false;
    const snapshot=structuredClone(simulated?eligibleSimulatedAutoApprovalBatches(batches,AGENT_DEMO_AUTO_APPROVAL_ALL):eligibleAgentMessageReviewBatches(batches));if(!snapshot.length)return false;
    activityVersion.current++;lock.current=true;setBusy(true);setError('');
    setSetupBoundary(ids=>ids??agent.messages.filter(message=>message.role==='user'||message.role==='assistant').map(message=>message.id));
    let completed=true;
    try{
      for(const batch of snapshot){
        if(!shouldContinue(batch)){completed=false;break;}
        await submitReview({action:'decide',batchId:batch.id,revision:batch.revision,items:batch.manifest,decision:'approved',...(simulated?{approvalSource:'automatic_demo'}:{})});
      }
    }catch{completed=false;setError('Approval stopped because a message changed or could not be checked. Review the latest drafts before continuing.');}
    finally{try{await refresh();}catch{completed=false;setError('Refresh to check which messages were approved before trying again.');}lock.current=false;setBusy(false);}
    return completed;
  }
  async function reviewAction(value:unknown):Promise<boolean>{
    if(lock.current)return false;activityVersion.current++;lock.current=true;setBusy(true);setError('');
    try{
      setSetupBoundary(ids=>ids??agent.messages.filter(message=>message.role==='user'||message.role==='assistant').map(message=>message.id));
      await submitReview(value);
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
  const initialResearch=snapshot.initialResearch;
  const initialResearchStatus=initialResearch?(initialResearch.source==='cached'&&initialResearch.status==='complete'?'Saved demo data ready':initialResearch.status==='queued'&&!initialResearch.jobId?'Research request saved':({queued:'Research queued',discovering:'Finding companies',crawling:'Research in progress',extracting:'Research in progress',complete:'Research saved',partial:'Research needs review',failed:'Research needs attention',cancelled:'Research cancelled',paused:'Agent paused',brief_changed:'The research brief changed'} as Record<string,string>)[initialResearch.status]??'Research status unavailable'):undefined;
  const latestMessageId=agent.messages.filter(message=>message.role==='user'||message.role==='assistant').at(-1)?.id;
  const visibleMessages=agent.messages.filter(m=>(m.role==='user'||m.role==='assistant')&&!(('noticeKind' in m)&&m.noticeKind==='setup_activity'));
  const {before,after}=messagesAroundInlineAction(visibleMessages,setupBoundary);
  const renderMessage=(message:(typeof visibleMessages)[number])=><AgentChatMessage key={message.id} ref={message.id===latestMessageId?latestMessage:undefined} data-chat-message-id={message.id} kind={message.role==='user'?'user':'assistant'} speaker={message.role==='user'?'You':'Acquire'}><p className="whitespace-pre-wrap break-words leading-7">{typeof message.content==='string'?message.content:''}</p>{message.role==='assistant'&&isAgentResearchBriefReviewNotice(message.content)&&(persisted?<button type="button" onClick={()=>{setBriefReviewOpen(true);requestAnimationFrame(()=>briefAnchor.current?.scrollIntoView({block:'start',behavior:'auto'}));}} className={`${actionStyles.action} mt-2 inline-flex min-h-11 items-center underline underline-offset-4`}>Review brief</button>:<Link href={snapshot.links.brief} className={`${actionStyles.action} mt-2 inline-flex min-h-11 items-center underline underline-offset-4`}>Review brief</Link>)}{learningEnabled&&message.role==='user'&&<button type="button" disabled={busy} onClick={()=>{setMemoryDraft({sourceMessageId:message.id,text:typeof message.content==='string'?message.content:''});setContextOpen(true);}} className="mt-1 min-h-9 text-[11px] text-[var(--muted)] underline underline-offset-4 disabled:opacity-40">Use as guidance</button>}</AgentChatMessage>;
  const renderTimeline=(messages:typeof visibleMessages,options?:AgentConversationOptions)=>groupAgentChatNotices(messages).map(group=>{
    if(group.kind==='message')return renderMessage(group.message);
    const latest=group.messages.some(message=>message.id===latestMessageId)?latestMessage:undefined;
    if(group.kind==='lead_updates')return <div key={'leads:'+group.messages[0].id} ref={latest}><AgentLeadActivity automaticMessages={options?.allowTestAutoApproval===true&&options.automation.initialMessages&&options.automation.replies&&options.automation.followUps&&options.automation.reviewFlaggedDrafts} pendingDrafts={new Set(reviews.filter(batch=>batch.state==='pending').flatMap(batch=>batch.operations).flatMap(op=>op.conversationId?[op.conversationId]:[]))} mandateId={initial.mandate.id} messages={group.messages as unknown as SavedAgentMessage[]} onReview={reviewConversation} onReviewDraft={id=>(document.getElementById('agent-draft-'+id)??reviewAnchor.current)?.scrollIntoView({block:'start',behavior:'smooth'})}/></div>;
    return <div key={'activity:'+group.messages[0].id} ref={latest}><AgentChatDetails summary={<>{group.kind==='channel_notices'?`${group.messages.length} contact channels selected`:'Outreach preparation'} · View activity</>}><div className="mt-2 space-y-3 border-l border-[var(--border)] pl-3">{group.messages.map(renderMessage)}</div></AgentChatDetails></div>;
  });
  const renderConversation=(setupCard:React.ReactNode,options?:AgentConversationOptions)=><div ref={transcript} aria-label="Conversation and reviews" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {persisted&&<CompanyIdentityReviews mandateId={initial.mandate.id} variant="agent" busy={busy} onResolved={()=>void refresh()}/>}
          <div role="log" aria-label="Conversation messages" aria-live="polite" className="mx-auto max-w-3xl space-y-6 px-5 py-6 sm:px-8">
            {!persisted&&!agent.messages.length&&<div className="py-10"><Sparkles size={23} className="mb-4 text-[var(--muted)]" aria-hidden="true"/><h2 className="text-lg font-medium">Where shall we start?</h2><p className="mt-2 max-w-md text-sm leading-relaxed text-[var(--muted)]">Review your mandate, check research, or plan the next conversation.</p></div>}
            {renderTimeline(before,options)}
        {persisted&&initialResearch&&initialResearch.status!=='awaiting_start'&&initialResearch.source!=='cached'&&<div className="flex flex-wrap items-center justify-between gap-2"><div className="space-y-1"><p role="status" aria-label="Initial research status" className="text-sm text-[var(--muted)]">{initialResearchStatus}</p>{(initialResearch.companies!==undefined||initialResearch.people!==undefined)&&<p className="text-xs text-[var(--muted)]">{[initialResearch.companies!==undefined?`${initialResearch.companies} companies`:null,initialResearch.people!==undefined?`${initialResearch.people} people`:null].filter(Boolean).join(' · ')}</p>}{initialResearch.blocker&&<p role="status" className="max-w-xl text-xs leading-relaxed">{initialResearch.blocker.message}</p>}</div><div className="flex gap-3"><button type="button" aria-expanded={resultsView==='companies'} aria-controls="agent-saved-results" onClick={()=>showResults('companies')} className={`${actionStyles.action} inline-flex min-h-11 items-center underline underline-offset-4`}>View companies</button><button type="button" disabled={busy} onClick={()=>{setBriefReviewOpen(true);requestAnimationFrame(()=>briefAnchor.current?.scrollIntoView({block:'start',behavior:'auto'}));}} className={`${actionStyles.action} inline-flex min-h-11 items-center underline underline-offset-4 disabled:opacity-40`}>Review brief</button></div></div>}
        {resultsView&&<div ref={resultsAnchor} id="agent-saved-results" className="scroll-mt-4"><AgentSavedResults key={`${initial.mandate.id}:${resultsView}`} mandateId={initial.mandate.id} view={resultsView} learningEnabled={learningEnabled} onClose={()=>setResultsView(null)}/></div>}
        {persisted&&(!initialResearch||briefReviewOpen)&&<div ref={briefAnchor} className="scroll-mt-4"><AgentBriefReview mandateId={initial.mandate.id} busy={busy} forceOpen={briefReviewOpen} onReviewed={async()=>{setBriefReviewOpen(false);await refresh();}}/></div>}

            <div key="live-setup" data-chat-inline-setup hidden={!setupCard}>{setupCard}</div>
            {renderTimeline(after,options)}
        {reviews.length>0&&<div ref={reviewAnchor} className="scroll-mt-4"><AgentMessageReviewQueue allowTestAutoApproval={options?.allowTestAutoApproval===true} automation={options?.automation??AGENT_DEMO_AUTO_APPROVAL_OFF} onAutomationStopped={()=>options?.onAutomationStopped()} onAutoApprove={(batches,guard)=>approveMessageBatches(batches,guard,true)} onApproveAll={approveMessageBatches} onFeedback={learningEnabled?guidanceAction:undefined} mandateId={initial.mandate.id} batches={reviews} busy={busy} onDecision={(batch,decision)=>void reviewAction({action:'decide',batchId:batch.id,revision:batch.revision,items:batch.manifest,decision})} onEdit={(batch,operationId,revision,body)=>reviewAction({action:'edit',batchId:batch.id,operationId,revision,body})}/></div>}
          </div>

        </div>;
  return <div className="mx-auto flex h-[calc(100dvh-88px)] min-h-[480px] max-w-[1440px] flex-col gap-4 p-4 sm:px-6 lg:h-dvh lg:pb-5">
    <header className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="min-w-0"><Link href={snapshot.links.brief} className="inline-flex min-h-7 items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft size={13} aria-hidden="true"/>Main workspace</Link><div className="flex items-center gap-2"><h1 title={snapshot.mandate.name} className="truncate text-xl font-semibold tracking-tight">{snapshot.mandate.displayName??snapshot.mandate.name}</h1><span className="hidden shrink-0 items-center gap-1 rounded-full bg-[var(--panel-raised)] px-2 py-1 text-[10px] font-medium text-[var(--muted)] sm:inline-flex"><Sparkles size={11} aria-hidden="true"/>Agent preview</span></div></div>
      <div className="flex shrink-0 items-center justify-between gap-1 sm:justify-end"><button type="button" onClick={()=>showResults('companies')} aria-expanded={resultsView==='companies'} aria-controls="agent-saved-results" className={`${actionStyles.action} inline-flex min-h-11 items-center rounded-lg px-3 text-[var(--muted)] hover:bg-[var(--panel-raised)]`}>Companies</button><button type="button" onClick={()=>setContextOpen(value=>!value)} aria-expanded={contextOpen} aria-controls="agent-context" className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-xs hover:bg-[var(--panel-raised)] ${contextOpen?'bg-[var(--panel-raised)]':'text-[var(--muted)]'}`}><PanelRight size={16} aria-hidden="true"/>Context{guidance.some(item=>item.state==='proposed')&&<span className="size-1.5 rounded-full bg-[var(--accent)]"><span className="sr-only">Guidance awaiting confirmation</span></span>}</button></div>
    </header>
    <div className={`grid min-h-0 flex-1 gap-4 ${contextOpen?'grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_280px] lg:grid-rows-1':''}`}>
      <section aria-label="Mandate conversation" className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-sm">
        {persisted?<AgentControlsPanel pendingReviews={reviews} focusedConversationId={focusedConversation?.id} conversationFocusRequest={focusedConversation?.request} pendingContactReview={reviews.some(batch=>batch.state==='pending'&&!batch.stale&&batch.operations.some(op=>op.name==='target.select'))} pendingMessageReviews={reviews.filter(batch=>batch.state==='pending'&&!batch.stale).flatMap(batch=>batch.operations).filter(op=>isAgentMessageReviewOperation(op.name)).length} onShowReviews={()=>reviewAnchor.current?.scrollIntoView({block:'start',behavior:'auto'})} onActionSaved={refresh} onConversationActionStart={()=>setSetupBoundary(ids=>ids??visibleMessages.map(message=>message.id))} onViewCompanies={()=>showResults('companies')} onViewPeople={()=>showResults('people')} savedData={initialResearch?.source==='cached'?{companies:initialResearch.companies,people:initialResearch.people}:undefined} mandateDescription={snapshot.mandate.description} initialResearchStatus={initialResearch?.status} initialResearchSource={initialResearch?.source} onFeedback={learningEnabled?guidanceAction:undefined} mandateId={initial.mandate.id} busy={busy} onBusyChange={value=>{activityVersion.current++;lock.current=value;setBusy(value);}}>{renderConversation}</AgentControlsPanel>:<><div className="border-b border-[var(--border)] px-5 py-3 text-sm font-medium">Mandate conversation</div>{renderConversation(null)}</>}
        <div className="shrink-0 border-t border-[var(--border)] px-4 py-3 sm:px-5">
          {persisted&&answering&&<button type="button" disabled={stopping} onClick={()=>void stopTurn()} className="mb-2 min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs disabled:opacity-50">{stopping?'Stopping…':'Stop answer'}</button>}
          <form onSubmit={event=>{event.preventDefault();void ask(question);}} className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--input)] p-1.5 focus-within:ring-1 focus-within:ring-[var(--muted)]"><label htmlFor="agent-question" className="sr-only">Ask about this mandate</label><input id="agent-question" value={question} onChange={event=>setQuestion(event.target.value)} maxLength={5000} disabled={busy} placeholder="Message Acquire…" className="min-h-10 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none"/><button disabled={busy||!question.trim()||!isReady} aria-label="Send question" className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--on-accent)] disabled:opacity-40">{busy?<LoaderCircle size={18} className="animate-spin motion-reduce:animate-none"/>:<ArrowUp size={18}/>}</button></form>
          <p className="mt-2 text-center text-[10px] text-[var(--muted)]">{persisted?'Saved to this mandate':'Saved for this visit'} · Human approval by default · A human sends the booking link</p>
        </div>
      </section>
      <aside id="agent-context" aria-label="Mandate context" className={`${contextOpen?'block':'hidden'} min-h-0 space-y-4 overflow-y-auto pr-1`}>
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Mandate context</h2><button type="button" onClick={()=>setContextOpen(false)} className="min-h-11 px-2 text-xs text-[var(--muted)]">Close</button></div>
        {learningEnabled&&(memoryDraft||guidance.some(item=>item.state!=='rejected'))&&<AgentGuidancePanel guidance={guidance} busy={busy} draft={memoryDraft} onCloseDraft={()=>setMemoryDraft(undefined)} onAction={guidanceAction}/>}
        <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4"><h3 className="text-sm font-semibold">Your brief</h3><p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">{snapshot.mandate.description}</p><button type="button" onClick={()=>{setBriefReviewOpen(true);setContextOpen(false);requestAnimationFrame(()=>briefAnchor.current?.scrollIntoView({block:'start',behavior:'auto'}));}} className={`${actionStyles.action} inline-flex min-h-11 items-center underline underline-offset-4`}>Edit brief</button></section>
      </aside>
    </div>
    {updatesPaused&&<p role="status" className="text-xs text-[var(--muted)]">Background updates are temporarily unavailable. Use refresh to catch up.</p>}
    {error && <p role="alert" className="text-sm text-[var(--status-red)]">{error}</p>}
  </div>;
}
