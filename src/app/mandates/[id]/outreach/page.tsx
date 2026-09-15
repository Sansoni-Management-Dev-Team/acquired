import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { loadOutreach } from "@/db/outreach-view";
import { MandateNavigation } from "@/components/mandate-workspace";
import { MandateTabs } from "@/components/mandate-tabs";
import { OutreachTable } from "@/components/outreach-table";
import { mandateOutreachHref } from "@/domain/mandate-navigation";

export default async function OutreachPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ targetId?: string }> }) {
  const { id } = await params;
  const { targetId } = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(mandateOutreachHref(id, targetId))}`);
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) redirect("/onboarding");
  const mandates = await new AcquisitionRepository(organizationId).listMandates();
  const mandate = mandates.find(m => m.id === id);
  if (!mandate) notFound();
  const { views, buyerProfile, canCompose } = await loadOutreach(organizationId, id, session.user.id);
  return <><MandateNavigation mandates={mandates} selected={id} tab="outreach" /><div className="space-y-5 p-5 sm:p-8"><header><p className="text-xs uppercase tracking-widest text-[var(--accent)]">Acquisition workspace</p><h1 className="mt-2 text-3xl font-semibold">{mandate.brief.name}</h1></header><MandateTabs mandateId={id} activeTab="outreach" /><OutreachTable key={id} mandateId={id} initialTargets={views} initialBuyerProfile={buyerProfile} initialTargetId={targetId} canCompose={canCompose} /></div></>;
}
