import { mandateOutreachHref } from "@/domain/mandate-navigation";
import { notFound, redirect, permanentRedirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { acquisitionSession } from "@/lib/acquisition-session";
import { MandateWorkspace } from "@/components/mandate-workspace";
import { requireDb } from "@/db/client";
import { contacts, organization } from "@/db/schema";
import { buyerProfileFromMetadata } from "@/domain/buyer-profile";
export default async function MandatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; targetId?: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const query = await searchParams;
  const requested = query.tab || "brief";
  if (requested === "outreach") permanentRedirect(mandateOutreachHref(id, query.targetId));
  const { organizationId } = await acquisitionSession();
  if (requested === "coverage") redirect(`/mandates/${id}?tab=targets`);
  const tab = ["brief","targets","pipeline"].includes(requested) ? requested : "brief";
  const repo = new AcquisitionRepository(organizationId);
  const mandates = await repo.listMandates();
  const mandate = mandates.find(m => m.id === id);
  if (!mandate) notFound();
  const [memberships, coverage, valuations, contactRows, organizations] = await Promise.all([repo.memberships(id), repo.coverage(id), repo.valuations(id), requireDb().select().from(contacts).where(eq(contacts.organizationId, organizationId)), requireDb().select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, organizationId))]);
  const initial = { mandate, memberships, coverage, valuations, buyerProfile: buyerProfileFromMetadata(organizations[0]?.metadata), contacts: contactRows.filter(c => memberships.some(m => m.target.id === c.targetId)).map(c => ({ targetId: c.targetId, name: c.displayName, role: c.role, reachable: !c.fictionalised && Boolean((c.personalData as Record<string, unknown>).email) && !(c.personalData as Record<string, unknown>).doNotContact })) };
  return <MandateWorkspace key={`${id}:${tab}`} mandates={mandates} initial={initial} tab={tab} />;
}
