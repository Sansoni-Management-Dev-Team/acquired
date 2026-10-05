import { timingSafeEqual } from "node:crypto";
import { syncPublishedCampaignWorkflows } from "@/lib/campaign-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const expected = process.env.OUTREACH_WORKER_SECRET;
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!expected || !supplied) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  try { return Response.json(await syncPublishedCampaignWorkflows()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Sync failed" }, { status: 500 }); }
}
