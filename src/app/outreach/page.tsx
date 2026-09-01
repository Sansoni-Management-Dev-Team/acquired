import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OutreachQueue, type OutreachTargetView } from "@/components/outreach-queue";
import { requireDb } from "@/db/client";
import { contacts, messages, organization, sequenceEnrolments, signals, targets } from "@/db/schema";
import { auth } from "@/lib/auth";
import { buyerProfileFromMetadata } from "@/domain/buyer-profile";

export default async function OutreachPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?next=/outreach");
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) redirect("/onboarding");
  const database = requireDb();
  const [targetRows, contactRows, signalRows, enrolmentRows, messageRows, organizationRows] = await Promise.all([
    database.select().from(targets).where(eq(targets.organizationId, organizationId)),
    database.select().from(contacts).where(eq(contacts.organizationId, organizationId)),
    database.select().from(signals).where(eq(signals.organizationId, organizationId)),
    database.select().from(sequenceEnrolments).where(eq(sequenceEnrolments.organizationId, organizationId)),
    database.select().from(messages).where(eq(messages.organizationId, organizationId)),
    database.select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, organizationId)).limit(1),
  ]);
  const enrolmentTargets = new Map(enrolmentRows.map((row) => [row.id, row.targetId]));
  const views: OutreachTargetView[] = targetRows.map((target) => {
    const firmographics = target.firmographics as Record<string, unknown>;
    const identifiers = target.identifiers as Record<string, unknown>;
    const outreach = firmographics.outreachContext && typeof firmographics.outreachContext === "object" ? firmographics.outreachContext as Record<string, unknown> : {};
    const sector = firmographics.sector && typeof firmographics.sector === "object" ? (firmographics.sector as { value?: unknown }).value : undefined;
    const established = firmographics.establishedYear && typeof firmographics.establishedYear === "object" ? (firmographics.establishedYear as { value?: unknown }).value : undefined;
    return {
      id: target.id, companyName: target.companyName, domain: target.domain || undefined, status: target.status,
      sector: typeof sector === "string" ? sector : undefined, description: typeof outreach.description === "string" ? outreach.description : undefined,
      establishedYear: typeof established === "number" ? established : undefined, firmableId: typeof identifiers.firmableId === "string" ? identifiers.firmableId : undefined,
      contacts: contactRows.filter((row) => row.targetId === target.id).map((row) => { const personal = row.personalData as Record<string, unknown>; return { id: row.id, displayName: row.displayName, role: row.role || undefined, email: typeof personal.email === "string" ? personal.email : undefined, fictionalised: row.fictionalised, doNotContact: personal.doNotContact === true }; }),
      signals: signalRows.filter((row) => row.targetId === target.id).map((row) => ({ id: row.id, kind: row.kind, value: row.value, weight: row.weight === "very_high" ? "very-high" as const : row.weight, direction: row.direction === "negative" ? "negative" as const : "positive" as const, provenance: { source: row.source, sourceUrl: row.sourceUrl || undefined, capturedAt: row.capturedAt.toISOString(), confidence: row.confidence } })),
      drafts: messageRows.filter((row) => enrolmentTargets.get(row.enrolmentId) === target.id).map((row) => ({ id: row.id, step: row.stepNumber, subject: row.subject, body: row.body, signalIds: Array.isArray(row.signalIds) ? row.signalIds.filter((id): id is string => typeof id === "string") : [], scheduledFor: row.scheduledFor?.toISOString(), state: row.state, gmailDraftSaved: Boolean(row.providerMessageId) })).sort((left, right) => left.step - right.step),
    };
  });
  return <div className="p-6 md:p-8"><p className="text-xs uppercase tracking-[.18em] text-[var(--accent)]">Human gate</p><h1 className="mt-2 text-3xl font-semibold">Outreach</h1><p className="mb-7 mt-3 max-w-2xl text-[var(--muted)]">Saved company evidence becomes outreach only after a decision-maker is selected. Approval saves the message to Gmail Drafts for review; live delivery remains off.</p><OutreachQueue initialTargets={views} initialBuyerProfile={buyerProfileFromMetadata(organizationRows[0]?.metadata)} /></div>;
}
