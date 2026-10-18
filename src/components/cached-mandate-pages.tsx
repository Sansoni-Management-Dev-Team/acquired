"use client";

import Link from "next/link";
import { SidebarRegistration } from "./app-shell";
import { HomeMandateCreate } from "./home-mandate-create";
import { useCachedMandates } from "./use-cached-mandates";
import { mandateTabHref } from "@/domain/mandate-navigation";

function CacheNotice({ loaded, error, retry }: { loaded: boolean; error: string; retry: () => void }) {
  if (error) return <p role="alert" className="text-sm text-[var(--muted)]">{error} <button type="button" onClick={retry} className="underline underline-offset-4">Retry</button></p>;
  if (!loaded) return <p role="status" className="text-sm text-[var(--muted)]">Loading your mandates…</p>;
  return null;
}

export function CachedMandateCreate({ agentModeEnabled = false, nativeAgentEnabled = false }: { agentModeEnabled?: boolean; nativeAgentEnabled?: boolean } = {}) {
  const cache = useCachedMandates();
  return <><SidebarRegistration value={{ mandates: cache.mandates.map(m => ({ id: m.id, name: m.brief.name })), tab: "brief" }} /><HomeMandateCreate nativeAgentEnabled={nativeAgentEnabled} agentModeEnabled={agentModeEnabled} mandates={cache.mandates} recentStatus={<CacheNotice {...cache} />} recentLoaded={cache.loaded} /></>;
}

export function CachedMandatesPage() {
  const cache = useCachedMandates();
  return <div className="space-y-6 p-5 sm:p-8"><SidebarRegistration value={{ mandates: cache.mandates.map(m => ({ id: m.id, name: m.brief.name })), tab: "brief" }} /><h1 className="text-3xl font-semibold">Acquisition mandates</h1><p className="text-[var(--muted)]">Keep each acquisition brief, target universe and pipeline separate.</p><Link className="inline-block rounded bg-[var(--accent)] px-4 py-2 text-[var(--on-accent)]" href="/">Create a mandate</Link><CacheNotice {...cache} /><div className="grid gap-4 md:grid-cols-2">{cache.mandates.map(m => <Link key={m.id} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 hover:border-[var(--accent)]" href={`/mandates/${m.id}`}><h2 className="text-lg font-semibold">{m.brief.name}</h2><p className="mt-3 text-sm text-[var(--muted)]">{m.brief.criteria.filter(c => c.state === "unknown").length} unanswered criteria · Open workspace</p></Link>)}</div>{cache.loaded && !cache.mandates.length && <p className="text-sm text-[var(--muted)]">Create your first mandate to review a brief and build its target universe.</p>}</div>;
}

const sectionLabels = { brief: "Brief", targets: "Companies", people: "People", sequences: "Sequences" };
export function MandatePicker({ section }: { section: keyof typeof sectionLabels }) {
  const cache = useCachedMandates();
  return <div className="mx-auto max-w-3xl space-y-6 p-5 sm:p-8"><h1 className="text-3xl font-semibold">{sectionLabels[section]}</h1><p className="text-[var(--muted)]">Choose a mandate to open {sectionLabels[section].toLowerCase()}.</p><Link href="/" className="inline-block rounded-lg bg-[var(--accent)] px-4 py-3 font-semibold text-[var(--on-accent)]">Create a new mandate</Link><CacheNotice {...cache} /><nav aria-label="Choose a mandate" className="grid gap-3">{cache.mandates.map(m => <Link key={m.id} href={mandateTabHref(m.id, section)} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 text-lg font-semibold hover:border-[var(--accent)]">{m.brief.name}</Link>)}</nav>{cache.loaded && !cache.mandates.length && <p className="text-[var(--muted)]">No mandates yet. Create a new mandate to get started.</p>}</div>;
}
