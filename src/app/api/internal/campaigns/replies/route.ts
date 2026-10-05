import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { replyChannels, replyEventSchema } from "@/domain/campaign-replies";
import { ingestCampaignReply } from "@/lib/campaign-reply-store";

export const runtime = "nodejs";
const payload = z.object({ organizationId: z.string().min(1).max(200), userId: z.string().min(1).max(200), channel: z.enum(replyChannels), accountIdentity: z.string().min(1).max(500), event: replyEventSchema }).strict();

export async function POST(request: Request) {
  const expected = Buffer.from(process.env.OUTREACH_WORKER_SECRET || "");
  const supplied = Buffer.from(request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || "");
  if (!expected.length || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const text = await request.text();
  if (Buffer.byteLength(text) > 16384) return Response.json({ error: "Reply event too large" }, { status: 413 });
  let data: unknown;
  try { data = JSON.parse(text); } catch { return Response.json({ error: "Invalid reply event" }, { status: 400 }); }
  const parsed = payload.safeParse(data);
  if (!parsed.success || new Date(parsed.data.event.receivedAt).getTime() > Date.now() + 5000) return Response.json({ error: "Invalid reply event" }, { status: 400 });
  try {
    const { organizationId, userId, channel, accountIdentity, event } = parsed.data;
    const outcome = await ingestCampaignReply({ organizationId, userId }, channel, accountIdentity, event);
    return Response.json({ acknowledged: true, outcome });
  } catch {
    // An unacknowledged event stays in the collector's durable queue. Do not
    // expose provider payloads or database details to the caller.
    return Response.json({ acknowledged: false, error: "Reply event could not be committed" }, { status: 503 });
  }
}
