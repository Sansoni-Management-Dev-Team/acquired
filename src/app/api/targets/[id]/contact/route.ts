import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { mapFirmablePerson } from "@/adapters/firmable-client";
import { targetSearchLog } from "@/adapters/live-target-search";
import { requireDb } from "@/db/client";
import { upsertFirmableContact } from "@/db/firmable-contacts";
import { FirmableHistoryRepository } from "@/db/firmable-history-repository";
import { OrganizationRepository } from "@/db/repositories";
import { targets } from "@/db/schema";
import { auth } from "@/lib/auth";

const requestSchema = z.object({ personId: z.string().min(1).optional() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "You must be signed in." }, { status: 401 });
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) return Response.json({ error: "Select an organisation first." }, { status: 403 });
  const { id } = await params;
  const database = requireDb();
  const [target] = await database.select().from(targets).where(and(eq(targets.id, id), eq(targets.organizationId, organizationId))).limit(1);
  if (!target) return Response.json({ error: "Target not found." }, { status: 404 });
  const identifiers = target.identifiers as Record<string, unknown>;
  const history = new FirmableHistoryRepository(database);
  const matched = target.firmableCompanyId ? undefined : await history.findCompany({ firmableId: typeof identifiers.firmableId === "string" ? identifiers.firmableId : undefined, domain: target.domain, abn: typeof identifiers.abn === "string" ? identifiers.abn : undefined });
  const firmableId = target.firmableCompanyId || matched?.id || "";
  if (!firmableId) return Response.json({ error: "This target has no Firmable company ID." }, { status: 409 });

  try {
    const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "A valid candidate is required." }, { status: 400 });
    targetSearchLog("contact.search.request", { targetId: id, providerMode: "stored", firmableCompanyId: firmableId, selectedPersonId: parsed.data.personId, strategy: "stored_profile" });
    const stored = (await history.latestPeople([firmableId])).get(firmableId) || [];
    const selected = parsed.data.personId ? stored.find(candidate => candidate.personId === parsed.data.personId) : stored.find(candidate => Boolean(candidate.profile)) || stored[0];
    if (!selected) return Response.json({ error: "No stored Firmable candidates are available. Refresh the company data first." }, { status: 404 });
    if (!selected.profile) return Response.json({ error: "This Firmable profile was not loaded. Refresh the company data and try again." }, { status: 409 });
    const person = mapFirmablePerson(selected.profile, { id: selected.personId }, process.env.ALLOW_REAL_PERSONAL_DATA !== "true");
    const candidate = { id: selected.personId, position: typeof selected.searchRecord.position === "string" ? selected.searchRecord.position : undefined, seniority: typeof selected.searchRecord.seniority === "string" ? selected.searchRecord.seniority : undefined, department: typeof selected.searchRecord.department === "string" ? selected.searchRecord.department : undefined, emailAvailable: selected.searchRecord.has_email === true || selected.searchRecord.email_available === true, phoneAvailable: selected.searchRecord.has_phone === true || selected.searchRecord.phone_available === true, rawResponse: selected.searchRecord };
    const saved = await upsertFirmableContact({ database, organizationId, targetId: id, companyId: firmableId, person, candidate });
    await new OrganizationRepository(database, organizationId).appendAudit({
      actorId: session.user.id,
      action: "contact.enriched",
      entityType: "contact",
      entityId: saved.id,
      metadata: { targetId: id, provider: "Firmable", fictionalised: person.fictionalised, doNotContact: person.doNotContact, personalFieldsStored: ["email", "phone"] },
    });
    targetSearchLog("contact.search.complete", { targetId: id, contactId: saved.id, fictionalised: person.fictionalised, emailAvailable: person.emailAvailable, phoneAvailable: person.phoneAvailable, doNotContact: person.doNotContact });
    return Response.json({ contactId: saved.id, fictionalised: person.fictionalised, doNotContact: person.doNotContact });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Contact enrichment failed";
    targetSearchLog("contact.search.failed", { targetId: id, message });
    return Response.json({ error: message }, { status: 502 });
  }
}
