import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "@/db/client";
import { OrganizationRepository } from "@/db/repositories";
import { contacts, mailboxConnections, messages, sequenceEnrolments } from "@/db/schema";
import { enrolmentStateAfterApproval } from "@/domain/outreach-approval";
import { syncGmailDraftApproval } from "@/domain/gmail-draft-approval";
import { auth } from "@/lib/auth";
import { connectionCanCompose, mailboxForConnection } from "@/lib/gmail-connection";

const requestSchema = z.object({ approved: z.boolean() });

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
  if (parsed.data.approved) {
    const [enrolment] = await database.select().from(sequenceEnrolments).where(and(eq(sequenceEnrolments.id, message.enrolmentId), eq(sequenceEnrolments.organizationId, organizationId))).limit(1);
    if (!enrolment?.contactId) return Response.json({ error: "The outreach sequence has no selected contact." }, { status: 409 });
    const [contact] = await database.select().from(contacts).where(and(eq(contacts.id, enrolment.contactId), eq(contacts.organizationId, organizationId))).limit(1);
    if (!contact) return Response.json({ error: "The selected contact was not found." }, { status: 409 });
    const personalData = contact.personalData as Record<string, unknown>;
    recipient = typeof personalData.email === "string" ? personalData.email : "";
    if (!recipient || personalData.doNotContact === true || contact.fictionalised) {
      return Response.json({ error: "A real, contactable recipient with an email is required." }, { status: 409 });
    }
  }

  let providerDraftId: string | null = message.providerMessageId;
  let providerThreadId: string | null = message.providerThreadId;
  const requiresGmail = parsed.data.approved || Boolean(providerDraftId);
  const [connection] = requiresGmail ? await database.select().from(mailboxConnections).where(and(
    eq(mailboxConnections.userId, session.user.id),
    eq(mailboxConnections.organizationId, organizationId),
    eq(mailboxConnections.provider, "gmail"),
  )).limit(1) : [];
  if (requiresGmail && !connection) return Response.json({ error: "Connect Gmail in Settings before approving outreach." }, { status: 409 });
  if (connection && !connectionCanCompose(connection)) return Response.json({ error: "Reconnect Gmail in Settings to grant draft permission." }, { status: 409 });
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
  await new OrganizationRepository(database, organizationId).appendAudit({ actorId: session.user.id, action: parsed.data.approved ? "outreach.message_approved" : "outreach.message_approval_revoked", entityType: "message", entityId: id, metadata: { enrolmentId: message.enrolmentId, enrolmentState, gmailDraftId: providerDraftId, liveDelivery: false } });
  console.info("[outreach-approval] gmail.synced", JSON.stringify({ messageId: id, state, enrolmentState, gmailDraftCreated: Boolean(providerDraftId), liveDelivery: false }));
  return Response.json({ messageId: id, state, enrolmentState, gmailDraftId: providerDraftId });
}
