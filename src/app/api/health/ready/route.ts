import { timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { requireDb } from "@/db/client";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const expected = process.env.APP_READINESS_SECRET;
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!expected || !supplied || Buffer.byteLength(expected) !== Buffer.byteLength(supplied)
    || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    return Response.json({ error: "Unauthorised" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    await requireDb().execute(sql`select 1`);
    return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
