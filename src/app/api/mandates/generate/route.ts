import { auth } from "@/lib/auth";
import { generateMandate } from "@/adapters/mandate-generation";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session.activeOrganizationId) return Response.json({ error: "Sign in and select an organisation." }, { status: 401 });
  try {
    return Response.json({ brief: await generateMandate() });
  } catch {
    return Response.json({ error: "The free AI service could not generate a valid brief. Please try again shortly." }, { status: 503 });
  }
}
