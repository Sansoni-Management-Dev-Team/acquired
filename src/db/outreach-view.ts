import { reviewedOutreachSignals } from "@/domain/reviewed-outreach-evidence";
import { and, eq } from "drizzle-orm";
import type { OutreachTargetView } from "@/components/outreach-queue";
import { requireDb } from "./client";
import { contacts, messages, organization, sequenceEnrolments, signals, targets } from "./schema";
import { accreditationSignals } from "@/domain/accreditation-evidence";
import { buyerProfileFromMetadata } from "@/domain/buyer-profile";
import { AcquisitionRepository } from "./acquisition-repository";
export async function loadOutreach(organizationId: string, mandateId: string) {
  const acquisition = new AcquisitionRepository(organizationId);
  const memberships = await acquisition.memberships(mandateId);
  const membershipIds = new Set(memberships.map(m => m.target.id));
  const database = requireDb();
  const [targetRows, contactRows, signalRows, enrolmentRows, messageRows, organizationRows] = await Promise.all([
    database.select().from(targets).where(eq(targets.organizationId, organizationId)),
    database.select().from(contacts).where(eq(contacts.organizationId, organizationId)),
    database.select().from(signals).where(eq(signals.organizationId, organizationId)),
    database.select().from(sequenceEnrolments).where(and(eq(sequenceEnrolments.organizationId, organizationId), eq(sequenceEnrolments.mandateId, mandateId))),
    database.select().from(messages).where(eq(messages.organizationId, organizationId)),
    database.select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, organizationId)).limit(1),
  ]);
  const enrolmentTargets = new Map(enrolmentRows.map((row) => [row.id, row.targetId]));
  const views: OutreachTargetView[] = targetRows.filter(target => membershipIds.has(target.id)).map((target) => {
    const firmographics = target.firmographics as Record<string, unknown>;
    const identifiers = target.identifiers as Record<string, unknown>;
    const outreach = firmographics.outreachContext && typeof firmographics.outreachContext === "object" ? firmographics.outreachContext as Record<string, unknown> : {};
    const sector = firmographics.sector && typeof firmographics.sector === "object" ? (firmographics.sector as { value?: unknown }).value : undefined;
    const established = firmographics.establishedYear && typeof firmographics.establishedYear === "object" ? (firmographics.establishedYear as { value?: unknown }).value : undefined;
    return {
      id: target.id, companyName: target.companyName, domain: target.domain || undefined, status: target.status,
      sector: typeof sector === "string" ? sector : undefined, description: typeof outreach.description === "string" ? outreach.description : undefined,
      establishedYear: typeof established === "number" ? established : undefined, firmableId: typeof identifiers.firmableId === "string" ? identifiers.firmableId : undefined,
      contacts: contactRows.filter((row) => row.targetId === target.id).map((row) => { const personal = row.personalData as Record<string, unknown>; return { id: row.id, displayName: row.displayName, role: row.role || undefined, email: typeof personal.email === "string" ? personal.email : undefined, emailStatus: typeof personal.emailStatus === "string" ? personal.emailStatus : "provider-supplied", sourceUrl: typeof (row.provenance as Record<string, unknown>).sourceUrl === "string" ? (row.provenance as Record<string, unknown>).sourceUrl as string : undefined, fictionalised: row.fictionalised, doNotContact: personal.doNotContact === true }; }),
      signals: [...reviewedOutreachSignals(memberships.find(m => m.target.id === target.id)), ...accreditationSignals(memberships.find(m => m.target.id === target.id)?.accreditations || []), ...signalRows.filter((row) => row.targetId === target.id).map((row) => ({ id: row.id, kind: row.kind, value: row.value, weight: row.weight === "very_high" ? "very-high" as const : row.weight, direction: row.direction === "negative" ? "negative" as const : "positive" as const, provenance: { source: row.source, sourceUrl: row.sourceUrl || undefined, capturedAt: row.capturedAt.toISOString(), confidence: row.confidence } }))],
      drafts: messageRows.filter((row) => enrolmentTargets.get(row.enrolmentId) === target.id).map((row) => ({ id: row.id, step: row.stepNumber, subject: row.subject, body: row.body, signalIds: Array.isArray(row.signalIds) ? row.signalIds.filter((id): id is string => typeof id === "string") : [], scheduledFor: row.scheduledFor?.toISOString(), state: row.state, gmailDraftSaved: Boolean(row.providerMessageId) })).sort((left, right) => left.step - right.step),
    };
  });
  return { views, buyerProfile: buyerProfileFromMetadata(organizationRows[0]?.metadata) };
}
