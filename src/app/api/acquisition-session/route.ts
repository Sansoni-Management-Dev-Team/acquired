import { auth } from "@/lib/auth";
import { mandateCacheScope } from "@/lib/mandate-cache-scope";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  const headers = { "Cache-Control": "private, no-store" };
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401, headers });
  if (!session.session.activeOrganizationId) return Response.json({ error: "Select a workspace." }, { status: 409, headers });
  return Response.json({ scope: mandateCacheScope(session), expiresAt: new Date(session.session.expiresAt).getTime() }, { headers });
}
