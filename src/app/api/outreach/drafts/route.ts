import { reviewedOutreachSignals } from "@/domain/reviewed-outreach-evidence";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "@/db/client";
import { OrganizationRepository } from "@/db/repositories";
import { contacts, messages, sequenceEnrolments, sequences, signals, targets } from "@/db/schema";
import { organization } from "@/db/schema";
import { DEFAULT_SEQUENCE } from "@/domain/outreach";
import { buyerProfileFromMetadata, publicBuyerProfile } from "@/domain/buyer-profile";
import { createOutreachDraftingProvider } from "@/adapters/outreach-drafting";
import type { Signal } from "@/domain/models";
import { auth } from "@/lib/auth";
import { accreditationSignals } from "@/domain/accreditation-evidence";
import { AcquisitionRepository } from "@/db/acquisition-repository";

const requestSchema = z.object({ mandateId: z.string().uuid(), targetId: z.string().uuid(), contactId: z.string().uuid().optional(), preview: z.boolean().default(false) });

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "You must be signed in." }, { status: 401 });
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) return Response.json({ error: "Select an organisation first." }, { status: 403 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "A valid target and contact are required." }, { status: 400 });
  const database = requireDb();
  const acquisition = new AcquisitionRepository(organizationId);
  const mandate = await acquisition.getMandate(parsed.data.mandateId);
  if (!mandate) return Response.json({ error: "Mandate not found" }, { status: 404 });
  const member = (await acquisition.memberships(mandate.id)).find(m => m.target.id === parsed.data.targetId);
  if (!member) return Response.json({ error: "Target not found in mandate" }, { status: 404 });
  if (["excluded", "parked"].includes(member.assessment.stage)) return Response.json({ error: "Return this target to the active pipeline before drafting." }, { status: 409 });
  const [target] = await database.select().from(targets).where(and(eq(targets.id, parsed.data.targetId), eq(targets.organizationId, organizationId))).limit(1);
  const [contact] = parsed.data.contactId ? await database.select().from(contacts).where(and(eq(contacts.id, parsed.data.contactId), eq(contacts.targetId, parsed.data.targetId), eq(contacts.organizationId, organizationId))).limit(1) : [];
  if (!target || (parsed.data.contactId && !contact) || (!parsed.data.preview && !contact)) return Response.json({ error: "Target or contact not found." }, { status: 404 });
  const personal = (contact?.personalData || {}) as Record<string, unknown>;
  if (personal.doNotContact === true) return Response.json({ error: "This contact is marked do-not-contact." }, { status: 409 });
  if (!parsed.data.preview && (typeof personal.email !== "string" || !personal.email)) return Response.json({ error: "A work email is required." }, { status: 409 });
  const signalRows = await database.select().from(signals).where(and(eq(signals.organizationId, organizationId), eq(signals.targetId, target.id)));
  const evidence: Signal[] = signalRows.map((row) => ({ id: row.id, kind: row.kind, value: row.value, weight: row.weight === "very_high" ? "very-high" : row.weight, direction: row.direction === "negative" ? "negative" : "positive", provenance: { source: row.source, sourceUrl: row.sourceUrl || undefined, capturedAt: row.capturedAt.toISOString(), confidence: row.confidence } }));
  evidence.push(...accreditationSignals(member.accreditations), ...reviewedOutreachSignals(member));
  if (!evidence.some((signal) => signal.direction === "positive")) return Response.json({ error: "At least one positive evidence signal is required." }, { status: 409 });
  const existingEnrolments = await database.select({ id: sequenceEnrolments.id }).from(sequenceEnrolments).where(and(eq(sequenceEnrolments.organizationId, organizationId), eq(sequenceEnrolments.targetId, target.id), eq(sequenceEnrolments.mandateId, mandate.id)));
  if (existingEnrolments.length) {
    const existingMessages = await database.select({ providerMessageId: messages.providerMessageId }).from(messages).where(and(eq(messages.organizationId, organizationId), eq(messages.enrolmentId, existingEnrolments[0].id)));
    if (existingMessages.some((item) => item.providerMessageId)) return Response.json({ error: "Revoke approved Gmail drafts before regenerating this sequence." }, { status: 409 });
  }

  const [organizationRow] = await database.select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, organizationId)).limit(1);
  const buyerProfile = buyerProfileFromMetadata(organizationRow?.metadata);
  if (!buyerProfile) return Response.json({ error: "Complete and save the buyer profile before generating outreach." }, { status: 409 });
  if (!buyerProfile.publicProfileApproved) return Response.json({ error: "Approve the public buyer profile before drafting." }, { status: 409 });
  const firmographics = target.firmographics as Record<string, unknown>;
  const outreachContext = firmographics.outreachContext && typeof firmographics.outreachContext === "object" ? firmographics.outreachContext as Record<string, unknown> : {};
  const provider = createOutreachDraftingProvider();

  let drafts;
  try {
    drafts = await provider.generateSequence({
      companyName: target.companyName,
      contactFirstName: contact?.displayName.split(/\s+/)[0] || "there",
      companyDescription: typeof outreachContext.description === "string" ? outreachContext.description : undefined,
      buyerProfile: publicBuyerProfile(buyerProfile, mandate.brief.outreachPositioning),
      signals: evidence,
      start: new Date(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI outreach drafting failed";
    console.error("[outreach-drafting] generation.failed", JSON.stringify({ provider: provider.providerName, targetId: target.id, message }));
    return Response.json({ error: message }, { status: 502 });
  }
  if (parsed.data.preview) return Response.json({ preview: drafts, saved: false });
  if (!contact) return Response.json({ error: "Select a contact before saving" }, { status: 409 });
  let [sequence] = await database.select().from(sequences).where(and(eq(sequences.organizationId, organizationId), eq(sequences.name, `Mandate ${mandate.id}`))).limit(1);
  if (!sequence) [sequence] = await database.insert(sequences).values({ organizationId, name: `Mandate ${mandate.id}`, steps: DEFAULT_SEQUENCE, createdBy: session.user.id }).returning();
  let [enrolment] = await database.select().from(sequenceEnrolments).where(and(eq(sequenceEnrolments.organizationId, organizationId), eq(sequenceEnrolments.targetId, target.id), eq(sequenceEnrolments.sequenceId, sequence.id))).limit(1);
  if (!enrolment) [enrolment] = await database.insert(sequenceEnrolments).values({ organizationId, mandateId: mandate.id, sequenceId: sequence.id, targetId: target.id, contactId: contact.id, state: "draft" }).returning();
  else await database.update(sequenceEnrolments).set({ contactId: contact.id, state: "draft" }).where(eq(sequenceEnrolments.id, enrolment.id));

  for (const draft of drafts) {
    const purpose = DEFAULT_SEQUENCE.find((step) => step.step === draft.step)?.purpose || "Evidence-led outreach";
    const values = { purpose, subject: draft.subject, body: draft.body, signalIds: draft.signalIds, state: "draft" as const, scheduledFor: draft.scheduledFor, updatedAt: new Date() };
    const [existing] = await database.select({ id: messages.id }).from(messages).where(and(eq(messages.enrolmentId, enrolment.id), eq(messages.stepNumber, draft.step))).limit(1);
    if (existing) await database.update(messages).set(values).where(eq(messages.id, existing.id));
    else await database.insert(messages).values({ organizationId, enrolmentId: enrolment.id, stepNumber: draft.step, ...values });
  }
  await new OrganizationRepository(database, organizationId).appendAudit({ actorId: session.user.id, action: "outreach.drafts_generated", entityType: "target", entityId: target.id, metadata: { mandateId: mandate.id, contactId: contact.id, sequenceId: sequence.id, messageCount: drafts.length, draftingMode: provider.mode, draftingProvider: provider.providerName, evidenceIds: evidence.map(({ id }) => id), liveDelivery: false } });
  return Response.json({ enrolmentId: enrolment.id, messageCount: drafts.length });
}
