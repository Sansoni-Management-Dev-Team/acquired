import { withOutreachSendTransaction } from '@/lib/outreach-send-transaction';
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "@/db/client";
import { OrganizationRepository } from "@/db/repositories";
import { messages } from "@/db/schema";
import { auth } from "@/lib/auth";
import { readOutreachMetadata, writeOutreachMetadata } from "@/domain/outreach";

const requestSchema = z.object({
  channel: z.enum(["email", "linkedin", "whatsapp"]).default("email"),
  subject: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(10).max(10_000),
}).superRefine((value, context) => {
  if (value.channel === "email" && !value.subject) context.addIssue({ code: "custom", path: ["subject"], message: "Email subject is required" });
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "You must be signed in." }, { status: 401 });
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) return Response.json({ error: "Select an organisation first." }, { status: 403 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter the required draft copy." }, { status: 400 });
  const { id } = await params;
  try { return await withOutreachSendTransaction(requireDb(), { organizationId, userId: session.user.id }, async database => {
  const [message] = await database.select({ ...getTableColumns(messages), contentRevision: sql<string>`${messages.updatedAt}::text` }).from(messages).where(and(eq(messages.id, id), eq(messages.organizationId, organizationId))).limit(1);
  if (!message) return Response.json({ error: "Draft not found." }, { status: 404 });
  if (!["draft", "approved"].includes(message.state)) return Response.json({ error: "This delivery record is read-only." }, { status: 409 });
  if (parsed.data.channel === "email" && message.state !== "draft") return Response.json({ error: "Revoke approval before editing this email." }, { status: 409 });
  const before = parsed.data.channel === "email"
    ? { subject: message.subject, body: message.body }
    : readOutreachMetadata(message.signalIds).channels[parsed.data.channel];
  const metadata = readOutreachMetadata(message.signalIds);
  const values = parsed.data.channel === "email"
    ? { subject: parsed.data.subject!, body: parsed.data.body, updatedAt: new Date() }
    : { signalIds: writeOutreachMetadata(metadata.signalIds, { ...metadata.channels, [parsed.data.channel]: { body: parsed.data.body } }), updatedAt: new Date() };
  const [saved] = await database.update(messages).set(values).where(and(
    eq(messages.id, id), eq(messages.organizationId, organizationId), eq(messages.state, message.state),
    sql`${messages.updatedAt} = ${message.contentRevision}::timestamptz`,
  )).returning({ id: messages.id });
  if (!saved) return Response.json({ error: "This draft changed while saving. Reload it before editing." }, { status: 409 });
  await new OrganizationRepository(database, organizationId).appendAudit({ actorId: session.user.id, action: "outreach.draft_edited", entityType: "message", entityId: id, before: { channel: parsed.data.channel, copy: before }, after: parsed.data });
  return Response.json({ messageId: id });
  }); } catch { return Response.json({ error: 'The draft could not be saved safely. Try again later.' }, { status: 503 }); }
}
