import { acquireOutreachBatch } from "@/lib/outreach-batch-guard";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { requireDb } from "@/db/client";
import { messages, sequenceEnrolments } from "@/db/schema";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { outreachBatchSchema, processOutreachBatch } from "@/domain/outreach-batch";
import { POST as generate } from "../drafts/route";
import { POST as approve } from "../messages/[id]/approval/route";

export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "You must be signed in." }, { status: 401 });
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) return Response.json({ error: "Select an organisation first." }, { status: 403 });
  const parsed = outreachBatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Select 1–20 distinct contacts and a valid mandate." }, { status: 400 });
  const { mandateId, action, rows } = parsed.data;
  const repo = new AcquisitionRepository(organizationId);
  if (!await repo.getMandate(mandateId)) return Response.json({ error: "Mandate not found." }, { status: 404 });
  const members = new Set((await repo.memberships(mandateId)).map(member => member.target.id));
  const database = requireDb();
  const childRequest = (body: unknown) => new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(body) });
  async function read(response: Response) {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Request failed");
    return result;
  }
  const release = acquireOutreachBatch(organizationId);
  if (!release) return Response.json({ error: "Another outreach batch is running. Retry shortly." }, { status: 429, headers: { "Retry-After": "1" } });
  try {
  const results = await processOutreachBatch(rows, async row => {
    if (!members.has(row.targetId)) throw new Error("Target not found in this mandate.");
    if (action === "generate") return read(await generate(childRequest({ mandateId, ...row, reuseExisting: true })));
    const enrolments = await database.select().from(sequenceEnrolments).where(and(eq(sequenceEnrolments.organizationId, organizationId), eq(sequenceEnrolments.mandateId, mandateId), eq(sequenceEnrolments.targetId, row.targetId), eq(sequenceEnrolments.contactId, row.contactId)));
    const drafts = (await Promise.all(enrolments.map(enrolment => database.select().from(messages).where(and(eq(messages.organizationId, organizationId), eq(messages.enrolmentId, enrolment.id)))))).flat();
    if (!drafts.length) throw new Error("Generate drafts for this contact first.");
    let saved = 0;
    const errors: string[] = [];
    for (const draft of drafts) {
      if (draft.providerMessageId && draft.state === "approved") { saved++; continue; }
      try { await read(await approve(childRequest({ approved: true }), { params: Promise.resolve({ id: draft.id }) })); saved++; }
      catch (error) { errors.push(`Step ${draft.stepNumber}: ${error instanceof Error ? error.message : "Sync failed"}`); }
    }
    if (errors.length) throw new Error(`${saved}/${drafts.length} drafts saved. ${errors.join("; ")}`);
    return { saved };
  });
  return Response.json({ results });
  } finally { release(); }
}
