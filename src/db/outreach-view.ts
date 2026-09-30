import { connectionCanCompose } from "@/lib/gmail-connection";
import { reviewedOutreachSignals } from "@/domain/reviewed-outreach-evidence";
import { and, eq, inArray } from "drizzle-orm";
import type { OutreachTargetView } from "@/components/outreach-queue";
import { requireDb } from "./client";
import { contacts, messages, mailboxConnections, organization, sequenceEnrolments, signals, targets } from "./schema";
import { accreditationSignals } from "@/domain/accreditation-evidence";
import { buyerProfileFromMetadata } from "@/domain/buyer-profile";
import { AcquisitionRepository } from "./acquisition-repository";
import { readOutreachMetadata } from "@/domain/outreach";
import { FirmableHistoryRepository } from "./firmable-history-repository";
import { storedFirmableContactData } from "./firmable-read-model";
export async function loadOutreach(organizationId: string, mandateId: string, userId?: string, targetId?: string) {
  const acquisition = new AcquisitionRepository(organizationId);
  const memberships = await acquisition.memberships(mandateId, targetId ? [targetId] : undefined);
  const membershipIds = new Set(memberships.map(m => m.target.id));
  const targetIds = [...membershipIds];
  const database = requireDb();
  const [targetRows, contactRows, signalRows, enrolmentRows, organizationRows] = await Promise.all([
    targetIds.length ? database.select().from(targets).where(and(eq(targets.organizationId, organizationId), inArray(targets.id, targetIds))) : [],
    targetIds.length ? database.select().from(contacts).where(and(eq(contacts.organizationId, organizationId), inArray(contacts.targetId, targetIds))) : [],
    targetIds.length ? database.select().from(signals).where(and(eq(signals.organizationId, organizationId), inArray(signals.targetId, targetIds))) : [],
    database.select().from(sequenceEnrolments).where(and(eq(sequenceEnrolments.organizationId, organizationId), eq(sequenceEnrolments.mandateId, mandateId), targetId ? eq(sequenceEnrolments.targetId, targetId) : undefined)),
    database.select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, organizationId)).limit(1),
  ]);
  const firmableCompanyIds = [...new Set(memberships.flatMap(member => member.target.sourceData?.firmable?.firmableId ? [member.target.sourceData.firmable.firmableId] : []))];
  const [sharedPeople, messageRows, mailboxRows] = await Promise.all([
    new FirmableHistoryRepository(database).latestPeople(firmableCompanyIds),
    enrolmentRows.length ? database.select().from(messages).where(and(eq(messages.organizationId, organizationId), inArray(messages.enrolmentId, enrolmentRows.map(row => row.id)))) : [],
    userId ? database.select().from(mailboxConnections).where(and(eq(mailboxConnections.organizationId, organizationId), eq(mailboxConnections.userId, userId), eq(mailboxConnections.provider, "gmail"))).limit(1) : [],
  ]);
  const enrolments = new Map(enrolmentRows.map((row) => [row.id, row]));
  const views: OutreachTargetView[] = targetRows.filter(target => membershipIds.has(target.id)).map((target) => {
    const membership = memberships.find(member => member.target.id === target.id);
    const sharedTarget = membership?.target;
    const firmographics = target.firmographics as Record<string, unknown>;
    const identifiers = target.identifiers as Record<string, unknown>;
    const outreach = firmographics.outreachContext && typeof firmographics.outreachContext === "object" ? firmographics.outreachContext as Record<string, unknown> : {};
    const sector = firmographics.sector && typeof firmographics.sector === "object" ? (firmographics.sector as { value?: unknown }).value : undefined;
    const established = firmographics.establishedYear && typeof firmographics.establishedYear === "object" ? (firmographics.establishedYear as { value?: unknown }).value : undefined;
    return {
      id: target.id, companyName: sharedTarget?.companyName || target.companyName, domain: sharedTarget?.domain || target.domain || undefined, status: target.status, stage: membership?.assessment.stage,
      sector: sharedTarget?.sector.value || (typeof sector === "string" ? sector : undefined), description: sharedTarget?.sourceData?.firmable?.description || (typeof outreach.description === "string" ? outreach.description : undefined),
      establishedYear: sharedTarget?.establishedYear.value ?? (typeof established === "number" ? established : undefined), firmableId: sharedTarget?.sourceData?.firmable?.firmableId || (typeof identifiers.firmableId === "string" ? identifiers.firmableId : undefined),
      contacts: contactRows.filter((row) => row.targetId === target.id).map((row) => {
        const personal = row.personalData as Record<string, unknown>;
        const personId = row.firmablePersonId || (typeof personal.firmablePersonId === "string" ? personal.firmablePersonId : undefined);
        const shared = personId && sharedTarget?.sourceData?.firmable?.firmableId
          ? (sharedPeople.get(sharedTarget.sourceData.firmable.firmableId) || []).find(person => person.personId === personId)
          : undefined;
        const capturedAt = Date.parse(String((row.provenance as Record<string, unknown>).capturedAt || ""));
        const newer = shared?.fetchedAt && shared.fetchedAt.getTime() > (Number.isFinite(capturedAt) ? capturedAt : 0) ? storedFirmableContactData(shared) : undefined;
        return { id: row.id, displayName: newer?.name || row.displayName, role: newer?.role || row.role || undefined, email: newer?.email || (typeof personal.email === "string" ? personal.email : undefined), phone: newer?.phone || (typeof personal.phone === "string" ? personal.phone : undefined), emailStatus: typeof personal.emailStatus === "string" ? personal.emailStatus : "provider-supplied", sourceUrl: newer?.linkedinUrl || (typeof (row.provenance as Record<string, unknown>).sourceUrl === "string" ? (row.provenance as Record<string, unknown>).sourceUrl as string : undefined), fictionalised: newer ? false : row.fictionalised, doNotContact: personal.doNotContact === true || newer?.doNotContact === true };
      }),
      signals: [...reviewedOutreachSignals(memberships.find(m => m.target.id === target.id)), ...accreditationSignals(memberships.find(m => m.target.id === target.id)?.accreditations || []), ...signalRows.filter((row) => row.targetId === target.id).map((row) => ({ id: row.id, kind: row.kind, value: row.value, weight: row.weight === "very_high" ? "very-high" as const : row.weight, direction: row.direction === "negative" ? "negative" as const : "positive" as const, provenance: { source: row.source, sourceUrl: row.sourceUrl || undefined, capturedAt: row.capturedAt.toISOString(), confidence: row.confidence } }))],
      drafts: messageRows.filter((row) => enrolments.get(row.enrolmentId)?.targetId === target.id).map((row) => {
        const metadata = readOutreachMetadata(row.signalIds);
        return { id: row.id, contactId: enrolments.get(row.enrolmentId)?.contactId || undefined, step: row.stepNumber, subject: row.subject, body: row.body, channels: { email: { subject: row.subject, body: row.body }, ...metadata.channels }, signalIds: metadata.signalIds, scheduledFor: row.scheduledFor?.toISOString(), state: row.state, gmailDraftSaved: Boolean(row.providerMessageId) };
      }).sort((left, right) => left.step - right.step),
    };
  });
  const [connection] = mailboxRows;
  return { canCompose: Boolean(connection && connectionCanCompose(connection)), views, buyerProfile: buyerProfileFromMetadata(organizationRows[0]?.metadata) };
}
