"use client";

import Link from "next/link";
import {useEffect} from "react";
import {useRouter} from "next/navigation";
import {useMandateCache} from "@/lib/mandate-cache";
import { BrowserLocalTime } from "./browser-local-time";
import { SidebarRegistration } from "./app-shell";
import { HomeMandateCreate } from "./home-mandate-create";
import { useCachedMandates,useSelectedMandate } from "./use-cached-mandates";
import { mandateTabHref } from "@/domain/mandate-navigation";
import {mandateResearchStatusLabels,type MandateResearchStatus} from "@/domain/mandate-research-status";

function CacheNotice({ loaded, error, retry }: { loaded: boolean; error: string; retry: () => void }) {
  if (error) return <p role="alert" className="text-sm text-[var(--muted)]">{error} <button type="button" onClick={retry} className="underline underline-offset-4">Retry</button></p>;
  if (!loaded) return <p role="status" className="text-sm text-[var(--muted)]">Loading your mandates…</p>;
  return null;
}

export function CachedMandateCreate({ agentModeEnabled = false, nativeAgentEnabled = false, sharedWorkflowEnabled = false }: { agentModeEnabled?: boolean; nativeAgentEnabled?: boolean; sharedWorkflowEnabled?: boolean } = {}) {
  const cache = useCachedMandates();
  return <><SidebarRegistration value={{ mandates: cache.mandates.map(m => ({ id: m.id, name: m.brief.name })), tab: "brief" }} /><HomeMandateCreate sharedWorkflowEnabled={sharedWorkflowEnabled} nativeAgentEnabled={nativeAgentEnabled} agentModeEnabled={agentModeEnabled} mandates={cache.mandates} recentStatus={<CacheNotice {...cache} />} recentLoaded={cache.loaded} /></>;
}

function ResearchStatus({status}:{status?:MandateResearchStatus}) {
  const label=status?mandateResearchStatusLabels[status]:'—';
  const dot=status==='complete'?'bg-emerald-500':status==='running'?'bg-blue-500':status==='partial'?'bg-amber-500':status==='failed'?'bg-red-500':'bg-[var(--muted)]';
  return <span aria-label={`Research status: ${status?label:'unavailable'}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--panel-raised)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)]"><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`}/>{label}</span>;
}

export function CachedMandatesPage() {
  const cache = useCachedMandates();
  return <div className="space-y-6 p-5 sm:p-8">
    <SidebarRegistration value={{ mandates: cache.mandates.map(m => ({ id: m.id, name: m.brief.name })), tab: "brief" }} />
    <h1 className="text-3xl font-semibold">Acquisition mandates</h1>
    <p className="text-[var(--muted)]">Keep each acquisition brief, target universe and pipeline separate.</p>
    <Link className="inline-block rounded bg-[var(--accent)] px-4 py-2 text-[var(--on-accent)]" href="/">Create a mandate</Link>
    <CacheNotice {...cache} />
    <div className="grid gap-4 md:grid-cols-2">{cache.mandates.map(m =>
      <Link key={m.id} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 hover:border-[var(--accent)]" onClick={()=>useMandateCache.getState().selectMandate(m.id)} href={`/mandates/${encodeURIComponent(m.id)}?tab=search+enrich`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="min-w-0 flex-1 text-lg font-semibold">{m.brief.name}</h2><ResearchStatus status={m.researchStatus}/></div>
        <p className="mt-2 text-xs text-[var(--muted)]">Created <BrowserLocalTime value={m.createdAt} /></p>
        <p className="mt-3 text-sm text-[var(--muted)]">{m.brief.criteria.filter(c => c.state === "unknown").length} unanswered criteria · View research</p>
      </Link>
    )}</div>
    {cache.loaded && !cache.mandates.length && <p className="text-sm text-[var(--muted)]">Create your first mandate to review a brief and build its target universe.</p>}
  </div>;
}

const sectionLabels = { brief: "Brief", targets: "Companies", people: "People", sequences: "Sequences" };
export function MandatePicker({ section }: { section: keyof typeof sectionLabels }) {
  const cache = useCachedMandates(),selected=useSelectedMandate(),router=useRouter();
  useEffect(()=>{if(selected)router.replace(mandateTabHref(selected,section));},[selected,section,router]);
  if(selected)return <p role="status" className="p-5 text-sm text-[var(--muted)]">Opening the selected mandate…</p>;
  if(!cache.loaded)return <div className="p-5"><CacheNotice {...cache}/></div>;
  return <div className="mx-auto max-w-3xl space-y-6 p-5 sm:p-8"><h1 className="text-3xl font-semibold">{sectionLabels[section]}</h1><p className="text-[var(--muted)]">Choose a mandate to open {sectionLabels[section].toLowerCase()}.</p><Link href="/" className="inline-block rounded-lg bg-[var(--accent)] px-4 py-3 font-semibold text-[var(--on-accent)]">Create a new mandate</Link><CacheNotice {...cache} /><nav aria-label="Choose a mandate" className="grid gap-3">{cache.mandates.map(m => <Link key={m.id} href={mandateTabHref(m.id, section)} onClick={()=>useMandateCache.getState().selectMandate(m.id)} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 text-lg font-semibold hover:border-[var(--accent)]">{m.brief.name}</Link>)}</nav>{cache.loaded && !cache.mandates.length && <p className="text-[var(--muted)]">No mandates yet. Create a new mandate to get started.</p>}</div>;
}
