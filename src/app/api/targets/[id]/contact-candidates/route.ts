import { and, eq } from "drizzle-orm";
import { requireDb } from "@/db/client";
import { FirmableHistoryRepository } from "@/db/firmable-history-repository";
import { targets } from "@/db/schema";
import { auth } from "@/lib/auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "You must be signed in." }, { status: 401 });
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) return Response.json({ error: "Select an organisation first." }, { status: 403 });
  const { id } = await params;
  const [target] = await requireDb().select().from(targets).where(and(eq(targets.id, id), eq(targets.organizationId, organizationId))).limit(1);
  if (!target) return Response.json({ error: "Target not found." }, { status: 404 });
  const identifiers = target.identifiers as Record<string, unknown>;
  const history = new FirmableHistoryRepository(requireDb());
  const matched = target.firmableCompanyId ? undefined : await history.findCompany({ firmableId: typeof identifiers.firmableId === "string" ? identifiers.firmableId : undefined, domain: target.domain, abn: typeof identifiers.abn === "string" ? identifiers.abn : undefined });
  const firmableId = target.firmableCompanyId || matched?.id || "";
  if (!firmableId) return Response.json({ error: "This target has no Firmable company ID." }, { status: 409 });

  const stored = (await history.latestPeople([firmableId])).get(firmableId) || [];
  const candidates = stored.map(person => {
    const record = person.searchRecord;
    return { id: person.personId, position: typeof record.position === "string" ? record.position : undefined, seniority: typeof record.seniority === "string" ? record.seniority : undefined, department: typeof record.department === "string" ? record.department : undefined, emailAvailable: record.has_email === true || record.email_available === true, phoneAvailable: record.has_phone === true || record.phone_available === true };
  });
  return Response.json({ candidates });
}
