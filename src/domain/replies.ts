import { createHmac, timingSafeEqual } from "node:crypto";

function secret() { return process.env.INBOUND_REPLY_SECRET || process.env.BETTER_AUTH_SECRET || ""; }
export function replyAddress(enrolmentId: string, domain: string) {
  const signature = createHmac("sha256", secret()).update(enrolmentId).digest("base64url").slice(0, 20);
  return `deal-${enrolmentId}.${signature}@${domain}`;
}
export function enrolmentFromReplyAddress(address: string) {
  const local = address.split("@")[0];
  const match = local.match(/^deal-(.+)\.([A-Za-z0-9_-]{20})$/);
  if (!match) throw new Error("Invalid reply address");
  const expected = createHmac("sha256", secret()).update(match[1]).digest("base64url").slice(0, 20);
  const a = Buffer.from(match[2]); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Invalid reply address");
  return match[1];
}
