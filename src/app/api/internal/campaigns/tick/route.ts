import { timingSafeEqual } from "node:crypto";
import { runCampaignTick } from "@/lib/campaign-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const expected = process.env.OUTREACH_WORKER_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  try { return Response.json(await runCampaignTick()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Worker failed" }, { status: 500 }); }
}
