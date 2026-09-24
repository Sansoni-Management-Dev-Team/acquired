import { mandateOutreachHref } from "@/domain/mandate-navigation";
import { notFound, redirect, permanentRedirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { acquisitionSession } from "@/lib/acquisition-session";
import { MandateWorkspace } from "@/components/mandate-workspace";
import { requireDb } from "@/db/client";
import { organization } from "@/db/schema";
import { buyerProfileFromMetadata } from "@/domain/buyer-profile";
import { loadWorkspaceContacts } from "@/db/firmable-read-model";
import { FirmableHistoryRepository } from "@/db/firmable-history-repository";
export default async function MandatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; targetId?: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const query = await searchParams;
  const requested = query.tab || "brief";
  if (requested === "outreach") permanentRedirect(mandateOutreachHref(id, query.targetId));
  const { organizationId } = await acquisitionSession();
  if (["coverage", "discover", "pipeline"].includes(requested)) redirect(`/mandates/${id}?tab=targets`);
  const tab = ["brief", "targets"].includes(requested) ? requested : "brief";
  const repo = new AcquisitionRepository(organizationId);
  const mandates = await repo.listMandates();
  const mandate = mandates.find(m => m.id === id);
  if (!mandate) notFound();
  const [memberships, coverage, valuations, organizations] = await Promise.all([repo.memberships(id), repo.coverage(id), repo.valuations(id), requireDb().select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, organizationId))]);
  const initial = { mandate, memberships, coverage, valuations, buyerProfile: buyerProfileFromMetadata(organizations[0]?.metadata), contacts: await loadWorkspaceContacts(requireDb(), organizationId, memberships), firmableRefreshes: await new FirmableHistoryRepository(requireDb()).latestRuns(organizationId, memberships.map(item => item.target.id)) };
  return <MandateWorkspace key={`${id}:${tab}`} mandates={mandates} initial={initial} tab={tab} />;
}
