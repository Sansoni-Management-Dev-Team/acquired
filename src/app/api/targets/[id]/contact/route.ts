import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { createTargetDataProvider } from "@/adapters/provider-mode";
import { targetSearchLog } from "@/adapters/live-target-search";
import { requireDb } from "@/db/client";
import { OrganizationRepository } from "@/db/repositories";
import { contacts, targets } from "@/db/schema";
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
  const firmableId = typeof identifiers.firmableId === "string" ? identifiers.firmableId : "";
  if (!firmableId) return Response.json({ error: "This target has no Firmable company ID." }, { status: 409 });
  const provider = createTargetDataProvider();
  const firmable = provider.firmable;
  if (provider.mode === "live" && !firmable.isConfigured()) return Response.json({ error: "Firmable is not configured." }, { status: 503 });

  try {
    const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "A valid candidate is required." }, { status: 400 });
    targetSearchLog("contact.search.request", { targetId: id, providerMode: provider.mode, firmableCompanyId: firmableId, selectedPersonId: parsed.data.personId, maxCandidates: 5, searchPoolLimit: parsed.data.personId ? 0 : 50, strategy: parsed.data.personId ? "selected_candidate" : "unfiltered_local_ranking" });
    let requestCount = 0;
    const candidates = parsed.data.personId ? [] : await firmable.searchDecisionMakers(firmableId, {
      max: 5,
      onAttempt: (attempt) => {
        requestCount += 1;
        targetSearchLog("contact.search.attempt", { targetId: id, requestNumber: requestCount, ...attempt });
      },
    });
    const selectedId = parsed.data.personId || candidates.find((candidate) => candidate.emailAvailable)?.id || candidates.find((candidate) => candidate.phoneAvailable)?.id || candidates[0]?.id;
    if (!selectedId) return Response.json({ error: "Firmable returned no owner/founder candidates for this company." }, { status: 404 });
    const person = await firmable.enrichPerson({ id: selectedId });
    const existingContacts = await database.select().from(contacts).where(and(eq(contacts.organizationId, organizationId), eq(contacts.targetId, id)));
    const existing = existingContacts.find((candidate) => (candidate.personalData as Record<string, unknown>).firmablePersonId === person.id);
    const contactValues = {
      displayName: person.name || "Decision-maker",
      role: person.position,
      personalData: { firmablePersonId: person.id, email: person.email, phone: person.phone, emailAvailable: person.emailAvailable, phoneAvailable: person.phoneAvailable, doNotContact: person.doNotContact },
      provenance: { source: "Firmable People Search + Enrichment", capturedAt: new Date().toISOString(), companyId: firmableId },
      fictionalised: person.fictionalised,
    };
    const [saved] = existing
      ? await database.update(contacts).set(contactValues).where(and(eq(contacts.id, existing.id), eq(contacts.organizationId, organizationId))).returning({ id: contacts.id })
      : await database.insert(contacts).values({ organizationId, targetId: id, ...contactValues }).returning({ id: contacts.id });
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
