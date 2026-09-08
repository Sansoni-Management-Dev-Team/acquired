import { auth } from "@/lib/auth";
// Retired unreviewed search entry point. Discovery now uses an existing reviewed mandate.
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "You must be signed in." }, { status: 401 });
  return Response.json({ error: "Create or select a mandate, review its brief, then build coverage from the mandate workspace." }, { status: 409 });
}
