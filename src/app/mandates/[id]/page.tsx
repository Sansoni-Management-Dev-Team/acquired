import {durableAgentEnabled} from "@/lib/agent-runtime";
import Link from "next/link";
import { mandateCompaniesHref, mandatePeopleHref } from "@/domain/mandate-navigation";
import { notFound, redirect, permanentRedirect } from "next/navigation";
import { z } from "zod";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { acquisitionSession } from "@/lib/acquisition-session";
import { MandateWorkspace } from "@/components/mandate-workspace";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { MandateSearchRun } from "@/components/mandate-search-run";
export default async function MandatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const query = await searchParams;
  const requested = (Array.isArray(query.tab) ? query.tab[0] : query.tab) || "brief";
  if (requested === "outreach") permanentRedirect(mandatePeopleHref(id));
  return <Suspense key={`${id}:${requested}`} fallback={<PageLoading />}><MandateContent id={id} requested={requested} query={query} /></Suspense>;
}

async function MandateContent({ id, requested, query }: { id: string; requested: string; query: Record<string, string | string[] | undefined> }) {
  const { organizationId } = await acquisitionSession();
  if (requested === "search enrich" || requested === "search") return <MandateSearchRun mandateId={id} />;
  if (["targets", "companies", "coverage", "discover", "pipeline"].includes(requested)) {
    const search=new URLSearchParams();
    for(const [key,value] of Object.entries(query))for(const item of Array.isArray(value)?value:value===undefined?[]:[value])search.append(key,item);
    redirect(mandateCompaniesHref(id,search));
  }
  const tab = "brief";
  const repo = new AcquisitionRepository(organizationId);
  const mandates = await repo.listMandates();
  const mandate = mandates.find(m => m.id === id);
  if (!mandate) notFound();

  const initial = { mandate, memberships: [], coverage: [], valuations: [], buyerProfile: null, contacts: [], firmableRefreshes: [] };
  return <><AgentEntry id={id} /><MandateWorkspace learningEnabled={process.env.AGENT_GUIDANCE_ENABLED==='true'&&process.env.AGENT_MODE_EXPLORATION_ENABLED==='true'&&durableAgentEnabled()} key={`${id}:${tab}`} mandates={mandates} initial={initial} tab={tab} /></>;
}

function AgentEntry({ id }: { id: string }) {
  if (process.env.AGENT_MODE_EXPLORATION_ENABLED !== "true") return null;
  return <div className="px-5 pt-4 sm:px-8"><Link href={`/mandates/${id}/agent`} className="text-sm text-[var(--muted)] underline underline-offset-4">Open agent workspace · research preview →</Link></div>;
}
