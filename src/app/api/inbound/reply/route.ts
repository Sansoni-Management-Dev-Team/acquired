import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "@/db/client";
import { replies, sequenceEnrolments } from "@/db/schema";
import { enrolmentFromReplyAddress } from "@/domain/replies";

const inboundSchema = z.object({ recipient: z.string().email(), sender: z.string().email(), providerReplyId: z.string().min(1), subject: z.string().optional(), bodyText: z.string().optional(), receivedAt: z.coerce.date().default(() => new Date()) });

export async function POST(request: Request) {
  if (!process.env.INBOUND_WEBHOOK_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.INBOUND_WEBHOOK_SECRET}`) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const parsed = inboundSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid inbound payload" }, { status: 400 });
  try {
    const enrolmentId = enrolmentFromReplyAddress(parsed.data.recipient);
    const database = requireDb();
    const enrolment = await database.select().from(sequenceEnrolments).where(eq(sequenceEnrolments.id, enrolmentId)).limit(1);
    if (!enrolment[0]) return NextResponse.json({ error: "Unknown reply route" }, { status: 404 });
    await database.transaction(async (tx) => {
      await tx.insert(replies).values({ organizationId: enrolment[0].organizationId, enrolmentId, providerReplyId: parsed.data.providerReplyId, fromAddress: parsed.data.sender, subject: parsed.data.subject, bodyText: parsed.data.bodyText, receivedAt: parsed.data.receivedAt });
      await tx.update(sequenceEnrolments).set({ state: "stopped", stopReason: "reply_received", nextStepAt: null }).where(eq(sequenceEnrolments.id, enrolmentId));
    });
    return NextResponse.json({ stopped: true });
  } catch { return NextResponse.json({ error: "Invalid reply route" }, { status: 400 }); }
}
