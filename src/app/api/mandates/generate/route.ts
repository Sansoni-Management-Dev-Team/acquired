import { auth } from "@/lib/auth";
import { generateMandate } from "@/adapters/mandate-generation";
import { z } from "zod";

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session.activeOrganizationId) return Response.json({ error: "Sign in and select an organisation." }, { status: 401 });
  const input = z.object({ description: z.string().trim().min(10).max(5000) }).safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Describe the businesses you're looking to buy." }, { status: 400 });
  try {
    return Response.json({ brief: await generateMandate(input.data.description) });
  } catch {
    return Response.json({ error: "Brief generation is temporarily unavailable. Please try again shortly or enter your brief manually." }, { status: 503 });
  }
}
