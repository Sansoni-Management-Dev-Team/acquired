import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "@/db/client";
import { OrganizationRepository } from "@/db/repositories";
import { messages } from "@/db/schema";
import { auth } from "@/lib/auth";

const requestSchema = z.object({ subject: z.string().trim().min(1).max(200), body: z.string().trim().min(10).max(10_000) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "You must be signed in." }, { status: 401 });
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) return Response.json({ error: "Select an organisation first." }, { status: 403 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a subject and message body." }, { status: 400 });
  const { id } = await params;
  const database = requireDb();
  const [message] = await database.select().from(messages).where(and(eq(messages.id, id), eq(messages.organizationId, organizationId))).limit(1);
  if (!message) return Response.json({ error: "Draft not found." }, { status: 404 });
  if (message.state !== "draft") return Response.json({ error: "Revoke approval before editing this message." }, { status: 409 });
  await database.update(messages).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(messages.id, id), eq(messages.organizationId, organizationId)));
  await new OrganizationRepository(database, organizationId).appendAudit({ actorId: session.user.id, action: "outreach.draft_edited", entityType: "message", entityId: id, before: { subject: message.subject, body: message.body }, after: parsed.data });
  return Response.json({ messageId: id });
}
