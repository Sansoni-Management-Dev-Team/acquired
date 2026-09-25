import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { processN8nCampaignStep } from "@/lib/campaign-service";

export const runtime = "nodejs";
const payload = z.object({ enrolmentId: z.uuid(), versionId: z.uuid(), stepIndex: z.number().int().nonnegative().max(24) }).strict();

export async function POST(request: Request) {
  const expected = process.env.OUTREACH_WORKER_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const parsed = payload.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid step" }, { status: 400 });
  try { return Response.json(await processN8nCampaignStep(parsed.data.enrolmentId, parsed.data.versionId, parsed.data.stepIndex)); }
  catch (error) {
    // Keep the n8n execution alive after a transient database or provider
    // failure. The send record prevents a repeat of an ambiguous Gmail send.
    if ((error as { status?: number })?.status === 404) return Response.json({ error: "Enrolment not found" }, { status: 404 });
    return Response.json({ outcome: "retry", nextStepAt: new Date(Date.now() + 5 * 60_000), error: error instanceof Error ? error.message : "Step failed" });
  }
}
