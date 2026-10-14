import { withOutreachSendTransaction } from '@/lib/outreach-send-transaction';
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "@/db/client";
import { OrganizationRepository } from "@/db/repositories";
import { contacts, messages, sequenceEnrolments, mandateTargets, organization } from "@/db/schema";
import { enrolmentStateAfterApproval } from "@/domain/outreach-approval";
import { auth } from "@/lib/auth";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { buyerProfileFromMetadata } from "@/domain/buyer-profile";
import {snapshotApprovedDraftBinding} from '@/lib/outreach-draft-binding';

const requestSchema = z.object({ approved: z.boolean() });

function approvalConflict(messageId: string, reason: string, error: string) {
  console.warn("[outreach-approval] request.rejected", JSON.stringify({ messageId, reason }));
  return Response.json({ error }, { status: 409 });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "You must be signed in." }, { status: 401 });
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) return Response.json({ error: "Select an organisation first." }, { status: 403 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Approval state is required." }, { status: 400 });
  const { id } = await params;
  try { return await withOutreachSendTransaction(requireDb(), { organizationId, userId: session.user.id }, async database => {
  const [message] = await database.select({ ...getTableColumns(messages), contentRevision: sql<string>`${messages.updatedAt}::text` }).from(messages).where(and(eq(messages.id, id), eq(messages.organizationId, organizationId))).limit(1);
  if (!message) return Response.json({ error: "Draft not found." }, { status: 404 });
  if (!["draft", "approved"].includes(message.state)) return approvalConflict(id, "delivery_record", "This delivery record cannot be changed through draft approval.");
  let recipient = "";
  const [enrolment] = await database.select().from(sequenceEnrolments).where(and(eq(sequenceEnrolments.id, message.enrolmentId), eq(sequenceEnrolments.organizationId, organizationId))).limit(1);
  if (parsed.data.approved) {
    if (!enrolment?.mandateId) return approvalConflict(id, "missing_mandate", "Review and regenerate this legacy draft in a mandate before approval.");
    const acquisition = new AcquisitionRepository(organizationId);
    const mandate = await acquisition.getMandate(enrolment.mandateId);
    const member = mandate && (await acquisition.memberships(mandate.id)).find(m => m.target.id === enrolment.targetId);
    const [buyer] = await database.select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, organizationId));
    if (!buyerProfileFromMetadata(buyer?.metadata)) return approvalConflict(id, "profile_required", "Complete the outreach profile in Settings before approval.");
    if (!member || ["excluded", "parked"].includes(member.assessment.stage)) return approvalConflict(id, "inactive_target", "The target is not active in this mandate.");
    if (!enrolment?.contactId) return approvalConflict(id, "missing_contact", "The outreach sequence has no selected contact.");
    const [contact] = await database.select().from(contacts).where(and(eq(contacts.id, enrolment.contactId), eq(contacts.organizationId, organizationId))).limit(1);
    if (!contact) return approvalConflict(id, "contact_not_found", "The selected contact was not found.");
    const personalData = contact.personalData as Record<string, unknown>;
    recipient = typeof personalData.email === "string" ? personalData.email : "";
    if (contact.fictionalised) return approvalConflict(id, "fictionalised_contact", "Select a real business contact before draft approval.");
    if (!recipient) return approvalConflict(id, "missing_contact_email", "A work email is required before draft approval.");
    if (personalData.doNotContact === true) return approvalConflict(id, "do_not_contact", "This contact is marked do-not-contact.");
  }

  // Approval changes only saved application state. Provider identifiers are historical
  // and remain untouched; this action cannot authorize or invoke provider dispatch.
  const state = parsed.data.approved ? "approved" as const : "draft" as const;
  if(parsed.data.approved)await snapshotApprovedDraftBinding(database,{organizationId,userId:session.user.id},message);
  const [saved] = await database.update(messages).set({ state, approvedBy: parsed.data.approved ? session.user.id : null, approvedAt: parsed.data.approved ? new Date() : null, updatedAt: new Date() }).where(and(
    eq(messages.id, id), eq(messages.organizationId, organizationId), eq(messages.state, message.state),
    sql`${messages.updatedAt} = ${message.contentRevision}::timestamptz`,
  )).returning({ id: messages.id });
  if (!saved) return approvalConflict(id, "draft_changed", "This draft changed during approval. Reload it and review the saved content.");
  const allStates = await database.select({ state: messages.state }).from(messages).where(and(eq(messages.enrolmentId, message.enrolmentId), eq(messages.organizationId, organizationId)));
  const enrolmentState = enrolmentStateAfterApproval(allStates.map((item) => item.state));
  await database.update(sequenceEnrolments).set({ state: enrolmentState, approvedBy: enrolmentState === "manual_confirmation" ? session.user.id : null, approvedAt: enrolmentState === "manual_confirmation" ? new Date() : null }).where(and(eq(sequenceEnrolments.id, message.enrolmentId), eq(sequenceEnrolments.organizationId, organizationId)));
  if (enrolment?.mandateId) {
    const nextStage = allStates.some(item => item.state === "approved") ? "outreach-approved" : "shortlisted";
    await database.update(mandateTargets).set({ assessment: sql`jsonb_set(${mandateTargets.assessment}, '{stage}', ${JSON.stringify(nextStage)}::jsonb)`, version: sql`${mandateTargets.version} + 1`, updatedAt: new Date() }).where(and(eq(mandateTargets.organizationId, organizationId), eq(mandateTargets.mandateId, enrolment.mandateId), eq(mandateTargets.targetId, enrolment.targetId), sql`${mandateTargets.assessment}->>'stage' IN ('identified', 'reviewing', 'shortlisted', 'outreach-approved')`));
  }
  await new OrganizationRepository(database, organizationId).appendAudit({ actorId: session.user.id, action: parsed.data.approved ? "outreach.message_approved" : "outreach.message_approval_revoked", entityType: "message", entityId: id, metadata: { enrolmentId: message.enrolmentId, enrolmentState, draftStorage: "application", historicalProviderDraftId: message.providerMessageId, liveDelivery: false } });
  console.info("[outreach-approval] saved", JSON.stringify({ messageId: id, state, enrolmentState, draftStorage: "application", liveDelivery: false }));
  return Response.json({ messageId: id, state, enrolmentState, draftStorage: "application", liveDelivery: false });
  }); } catch { return Response.json({ error: 'The draft could not be saved safely. Try again later.' }, { status: 503 }); }
}
