import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { withCampaignWorkBudget } from "@/lib/campaign-work-budget";
import { campaignReplyReadiness } from "@/lib/campaign-reply-readiness";

export const runtime = "nodejs";
const scope = z.object({ organizationId: z.string().min(1).max(255), userId: z.string().min(1).max(255) });
export async function GET(request: Request) {
  const expected = process.env.OUTREACH_WORKER_SECRET;
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!expected || !supplied) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const left = Buffer.from(expected), right = Buffer.from(supplied);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const parsed = scope.safeParse({ organizationId: params.get("organizationId"), userId: params.get("userId") });
  if (!parsed.success) return Response.json({ error: "An organization and owner are required" }, { status: 400 });
  try { return Response.json(await withCampaignWorkBudget(20_000, () => campaignReplyReadiness({ organizationId: parsed.data.organizationId, userId: parsed.data.userId })), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "Campaign readiness could not be established" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
