import { eq } from "drizzle-orm";
import { buyerProfileFromMetadata, buyerProfileSchema, metadataWithBuyerProfile } from "@/domain/buyer-profile";
import { requireDb } from "@/db/client";
import { OrganizationRepository } from "@/db/repositories";
import { organization } from "@/db/schema";
import { auth } from "@/lib/auth";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "You must be signed in." }, { status: 401 });
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) return Response.json({ error: "Select an organisation first." }, { status: 403 });
  const [row] = await requireDb().select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, organizationId)).limit(1);
  if (!row) return Response.json({ error: "Organisation not found." }, { status: 404 });
  return Response.json({ profile: buyerProfileFromMetadata(row.metadata) });
}

export async function PUT(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "You must be signed in." }, { status: 401 });
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) return Response.json({ error: "Select an organisation first." }, { status: 403 });
  const parsed = buyerProfileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map(issue => issue.message).join(". ") }, { status: 400 });
  const database = requireDb();
  const [row] = await database.select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, organizationId)).limit(1);
  if (!row) return Response.json({ error: "Organisation not found." }, { status: 404 });
  await database.update(organization).set({ metadata: metadataWithBuyerProfile(row.metadata, parsed.data) }).where(eq(organization.id, organizationId));
  await new OrganizationRepository(database, organizationId).appendAudit({
    actorId: session.user.id, action: "outreach.buyer_profile_updated", entityType: "organization", entityId: organizationId,
    metadata: { storedFields: Object.keys(parsed.data) },
  });
  return Response.json({ profile: parsed.data });
}
