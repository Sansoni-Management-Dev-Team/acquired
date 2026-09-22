import { auth } from "@/lib/auth";
import { generateMandate } from "@/adapters/mandate-generation";

// Allow the 45-second free inference budget, the 40-second paid fallback, plus authentication and response overhead.
export const maxDuration = 120;

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session.activeOrganizationId) return Response.json({ error: "Sign in and select an organisation." }, { status: 401 });
  try {
    return Response.json({ brief: await generateMandate() });
  } catch {
    return Response.json({ error: "Brief generation is temporarily unavailable. Please try again shortly or enter your brief manually." }, { status: 503 });
  }
}
