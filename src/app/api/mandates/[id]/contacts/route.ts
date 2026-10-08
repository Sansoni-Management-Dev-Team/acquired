import { z } from "zod";
import { auth } from "@/lib/auth";
import { createContactRequest } from "@/domain/contact-record";
import { CampaignError, createMandateContact } from "@/lib/campaign-service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session.activeOrganizationId) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const { id } = await params;
  const parsed = createContactRequest.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return Response.json({ error: parsed.success ? "Invalid mandate" : parsed.error.issues.map(issue => issue.message).join(". ") }, { status: 400 });
  try {
    return Response.json(await createMandateContact({ organizationId: session.session.activeOrganizationId, userId: session.user.id }, id, parsed.data), { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not add person" }, { status: error instanceof CampaignError ? error.status : 500 });
  }
}
