import { eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { requireDb } from "@/db/client";
import { organization } from "@/db/schema";
import { researchSettingsFromMetadata, researchSettingsSchema } from "@/domain/research-settings";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  const org = session?.session.activeOrganizationId;
  if (!org) return Response.json({ error: "Sign in and select an organisation." }, { status: 401 });
  const [row] = await requireDb().select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, org)).limit(1);
  return Response.json(researchSettingsFromMetadata(row?.metadata), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  const org = session?.session.activeOrganizationId;
  if (!org) return Response.json({ error: "Sign in and select an organisation." }, { status: 401 });
  const parsed = researchSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a whole number from 1 to 100." }, { status: 400 });
  const [row] = await requireDb().update(organization).set({ metadata: sql`jsonb_set(coalesce(nullif(${organization.metadata}, '')::jsonb, '{}'::jsonb), '{researchSettings}', ${JSON.stringify(parsed.data)}::jsonb)::text` }).where(eq(organization.id, org)).returning({ id: organization.id });
  if (!row) return Response.json({ error: "Organisation not found." }, { status: 404 });
  return Response.json(parsed.data);
}
