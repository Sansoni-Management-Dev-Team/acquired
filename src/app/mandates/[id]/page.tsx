import { mandatePeopleHref } from "@/domain/mandate-navigation";
import { notFound, redirect, permanentRedirect } from "next/navigation";
import { z } from "zod";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { acquisitionSession } from "@/lib/acquisition-session";
import { MandateWorkspace } from "@/components/mandate-workspace";
import { CompanyListRepository } from '@/db/company-list-repository';
import { defaultCompanyListQuery } from '@/domain/company-list';
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
export default async function MandatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; targetId?: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const query = await searchParams;
  const requested = query.tab || "brief";
  if (requested === "outreach") permanentRedirect(mandatePeopleHref(id));
  return <Suspense key={`${id}:${requested}`} fallback={<PageLoading />}><MandateContent id={id} requested={requested} /></Suspense>;
}

async function MandateContent({ id, requested }: { id: string; requested: string }) {
  const { organizationId } = await acquisitionSession();
  if (["coverage", "discover", "pipeline"].includes(requested)) redirect(`/mandates/${id}?tab=targets`);
  const tab = ["brief", "targets"].includes(requested) ? requested : "brief";
  const repo = new AcquisitionRepository(organizationId);
  const mandates = await repo.listMandates();
  const mandate = mandates.find(m => m.id === id);
  if (!mandate) notFound();
  if (tab === 'targets') {
    const companies = await new CompanyListRepository(organizationId).load(id,defaultCompanyListQuery);
    if (!companies || 'unchanged' in companies) notFound();
    const initial = { mandate, memberships: [], coverage: [], valuations: [], buyerProfile: null, contacts: [], firmableRefreshes: [] };
    return <MandateWorkspace key={`${id}:${tab}`} mandates={mandates} initial={initial} initialCompanies={companies} tab={tab} />;
  }
  const initial = { mandate, memberships: [], coverage: [], valuations: [], buyerProfile: null, contacts: [], firmableRefreshes: [] };
  return <MandateWorkspace key={`${id}:${tab}`} mandates={mandates} initial={initial} tab={tab} />;
}
