import { and, eq } from "drizzle-orm";
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
  const database = requireDb();
  const [message] = await database.select().from(messages).where(and(eq(messages.id, id), eq(messages.organizationId, organizationId))).limit(1);
  if (!message) return Response.json({ error: "Draft not found." }, { status: 404 });
  if (parsed.data.channel === "email" && message.state !== "draft") return Response.json({ error: "Revoke approval before editing this email." }, { status: 409 });
  const before = parsed.data.channel === "email"
    ? { subject: message.subject, body: message.body }
    : readOutreachMetadata(message.signalIds).channels[parsed.data.channel];
  if (parsed.data.channel === "email") {
    await database.update(messages).set({ subject: parsed.data.subject!, body: parsed.data.body, updatedAt: new Date() }).where(and(eq(messages.id, id), eq(messages.organizationId, organizationId)));
  } else {
    const metadata = readOutreachMetadata(message.signalIds);
    await database.update(messages).set({ signalIds: writeOutreachMetadata(metadata.signalIds, { ...metadata.channels, [parsed.data.channel]: { body: parsed.data.body } }), updatedAt: new Date() }).where(and(eq(messages.id, id), eq(messages.organizationId, organizationId)));
  }
  await new OrganizationRepository(database, organizationId).appendAudit({ actorId: session.user.id, action: "outreach.draft_edited", entityType: "message", entityId: id, before: { channel: parsed.data.channel, copy: before }, after: parsed.data });
  return Response.json({ messageId: id });
}
