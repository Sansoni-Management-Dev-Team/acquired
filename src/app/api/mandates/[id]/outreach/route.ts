import { z } from "zod";
import { auth } from "@/lib/auth";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { loadOutreach } from "@/db/outreach-view";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  const org = session?.session.activeOrganizationId;
  if (!org) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Invalid mandate" }, { status: 400 });
  const mandate = await new AcquisitionRepository(org).getMandate(id);
  if (!mandate) return Response.json({ error: "Mandate not found" }, { status: 404 });
  const targetId = new URL(request.url).searchParams.get('targetId') || undefined;
  if (targetId && !z.uuid().safeParse(targetId).success) return Response.json({ error: 'Invalid company' }, { status: 400 });
  return Response.json(await loadOutreach(org, id, session.user.id, targetId), { headers: { "Cache-Control": "no-store" } });
}
