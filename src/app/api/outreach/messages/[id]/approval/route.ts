import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "@/db/client";
import { OrganizationRepository } from "@/db/repositories";
import { contacts, mailboxConnections, messages, sequenceEnrolments, mandateTargets, organization } from "@/db/schema";
import { enrolmentStateAfterApproval } from "@/domain/outreach-approval";
import { syncGmailDraftApproval } from "@/domain/gmail-draft-approval";
import { auth } from "@/lib/auth";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { buyerProfileFromMetadata } from "@/domain/buyer-profile";
import { connectionCanCompose, mailboxForConnection } from "@/lib/gmail-connection";

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
  const database = requireDb();
  const [message] = await database.select().from(messages).where(and(eq(messages.id, id), eq(messages.organizationId, organizationId))).limit(1);
  if (!message) return Response.json({ error: "Draft not found." }, { status: 404 });
  let recipient = "";
  const [enrolment] = await database.select().from(sequenceEnrolments).where(and(eq(sequenceEnrolments.id, message.enrolmentId), eq(sequenceEnrolments.organizationId, organizationId))).limit(1);
  if (parsed.data.approved) {
    if (!enrolment?.mandateId) return approvalConflict(id, "missing_mandate", "Review and regenerate this legacy draft in a mandate before approval.");
    const acquisition = new AcquisitionRepository(organizationId);
    const mandate = await acquisition.getMandate(enrolment.mandateId);
    const member = mandate && (await acquisition.memberships(mandate.id)).find(m => m.target.id === enrolment.targetId);
    const [buyer] = await database.select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, organizationId));
    if (!mandate?.brief.disclosureApproved || !buyerProfileFromMetadata(buyer?.metadata)?.publicProfileApproved) return approvalConflict(id, "disclosure_not_approved", "Approve the mandate disclosure and public buyer profile before approval.");
    if (!member || ["excluded", "parked"].includes(member.assessment.stage)) return approvalConflict(id, "inactive_target", "The target is not active in this mandate.");
    if (!enrolment?.contactId) return approvalConflict(id, "missing_contact", "The outreach sequence has no selected contact.");
    const [contact] = await database.select().from(contacts).where(and(eq(contacts.id, enrolment.contactId), eq(contacts.organizationId, organizationId))).limit(1);
    if (!contact) return approvalConflict(id, "contact_not_found", "The selected contact was not found.");
    const personalData = contact.personalData as Record<string, unknown>;
    recipient = typeof personalData.email === "string" ? personalData.email : "";
    if (contact.fictionalised) return approvalConflict(id, "fictionalised_contact", "Select and enrich a real Firmable contact before Gmail approval.");
    if (!recipient) return approvalConflict(id, "missing_contact_email", "A verified contact email is required before Gmail approval.");
    if (personalData.doNotContact === true) return approvalConflict(id, "do_not_contact", "This contact is marked do-not-contact.");
  }

  let providerDraftId: string | null = message.providerMessageId;
  let providerThreadId: string | null = message.providerThreadId;
  const requiresGmail = parsed.data.approved || Boolean(providerDraftId);
  const [connection] = requiresGmail ? await database.select().from(mailboxConnections).where(and(
    eq(mailboxConnections.userId, session.user.id),
    eq(mailboxConnections.organizationId, organizationId),
    eq(mailboxConnections.provider, "gmail"),
  )).limit(1) : [];
  if (requiresGmail && !connection) return approvalConflict(id, "gmail_not_connected", "Connect Gmail in Settings before approving outreach.");
  if (connection && !connectionCanCompose(connection)) return approvalConflict(id, "gmail_compose_scope_missing", "Reconnect Gmail in Settings to grant draft permission.");
  try {
    const mailbox = connection ? mailboxForConnection(connection) : null;
    const synced = await syncGmailDraftApproval({ approved: parsed.data.approved, mailbox, userId: session.user.id, recipient, subject: message.subject, body: message.body, providerDraftId, providerThreadId });
    providerDraftId = synced.providerDraftId;
    providerThreadId = synced.providerThreadId;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Gmail draft synchronization failed";
    if (connection && errorMessage.startsWith("Google token refresh failed")) {
      await database.update(mailboxConnections).set({ reconnectRequired: true, updatedAt: new Date() }).where(eq(mailboxConnections.id, connection.id));
    }
    console.error("[outreach-approval] gmail.failed", JSON.stringify({ messageId: id, approved: parsed.data.approved, message: errorMessage }));
    return Response.json({ error: errorMessage }, { status: 502 });
  }
  const state = parsed.data.approved ? "approved" as const : "draft" as const;
  await database.update(messages).set({ state, providerMessageId: providerDraftId, providerThreadId, approvedBy: parsed.data.approved ? session.user.id : null, approvedAt: parsed.data.approved ? new Date() : null, updatedAt: new Date() }).where(and(eq(messages.id, id), eq(messages.organizationId, organizationId)));
  const allStates = await database.select({ state: messages.state }).from(messages).where(and(eq(messages.enrolmentId, message.enrolmentId), eq(messages.organizationId, organizationId)));
  const enrolmentState = enrolmentStateAfterApproval(allStates.map((item) => item.state));
  await database.update(sequenceEnrolments).set({ state: enrolmentState, approvedBy: enrolmentState === "manual_confirmation" ? session.user.id : null, approvedAt: enrolmentState === "manual_confirmation" ? new Date() : null }).where(and(eq(sequenceEnrolments.id, message.enrolmentId), eq(sequenceEnrolments.organizationId, organizationId)));
  if (enrolment?.mandateId) {
    const nextStage = allStates.some(item => item.state === "approved") ? "outreach-approved" : "shortlisted";
    await database.update(mandateTargets).set({ assessment: sql`jsonb_set(${mandateTargets.assessment}, '{stage}', ${JSON.stringify(nextStage)}::jsonb)`, version: sql`${mandateTargets.version} + 1`, updatedAt: new Date() }).where(and(eq(mandateTargets.organizationId, organizationId), eq(mandateTargets.mandateId, enrolment.mandateId), eq(mandateTargets.targetId, enrolment.targetId), sql`${mandateTargets.assessment}->>'stage' IN ('identified', 'reviewing', 'shortlisted', 'outreach-approved')`));
  }
  await new OrganizationRepository(database, organizationId).appendAudit({ actorId: session.user.id, action: parsed.data.approved ? "outreach.message_approved" : "outreach.message_approval_revoked", entityType: "message", entityId: id, metadata: { enrolmentId: message.enrolmentId, enrolmentState, gmailDraftId: providerDraftId, liveDelivery: false } });
  console.info("[outreach-approval] gmail.synced", JSON.stringify({ messageId: id, state, enrolmentState, gmailDraftCreated: Boolean(providerDraftId), liveDelivery: false }));
  return Response.json({ messageId: id, state, enrolmentState, gmailDraftId: providerDraftId });
}
