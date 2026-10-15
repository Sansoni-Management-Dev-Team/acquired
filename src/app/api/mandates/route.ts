import { auth } from "@/lib/auth";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { briefSchema } from "@/domain/acquisition";
import { mandateCacheScope } from "@/lib/mandate-cache-scope";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session.activeOrganizationId) return Response.json({ error: "Sign in and select an organisation." }, { status: 401 });
  return Response.json({ mandates: await new AcquisitionRepository(session.session.activeOrganizationId).listMandates(), scope: mandateCacheScope(session) }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session.activeOrganizationId) return Response.json({ error: "Sign in and select an organisation." }, { status: 401 });
  const parsed = briefSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map(i => i.message).join("; ") }, { status: 400 });
  const id = await new AcquisitionRepository(session.session.activeOrganizationId).saveBrief(parsed.data, session.user.id);
  return Response.json({ id }, { status: 201 });
}
