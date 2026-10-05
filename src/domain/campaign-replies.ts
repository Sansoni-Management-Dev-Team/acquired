import { z } from "zod";

export const replyChannels = ["email", "whatsapp", "linkedin"] as const;
export type ReplyChannel = typeof replyChannels[number];
export type ReplyIdentity = { contactId: string; email: string; identity: string; since: Date };
export const replyEventSchema = z.object({ id: z.string().min(1).max(500), fromIdentity: z.string().min(1).max(500), receivedAt: z.iso.datetime() }).strict();
export const replyPageSchema = z.object({ accountIdentity: z.string().min(1).max(500), events: z.array(replyEventSchema).max(500), nextCursor: z.string().max(4000).nullable(), complete: z.boolean(), checkedAt: z.iso.datetime() }).strict();
export type ReplyEvent = z.infer<typeof replyEventSchema>;
export type ReplyPage = z.infer<typeof replyPageSchema>;
export const replyChannelLabel = (channel: ReplyChannel) => channel === "email" ? "Email" : channel === "whatsapp" ? "WhatsApp" : "LinkedIn";

export function replyIdentity(channel: ReplyChannel, raw: string): string | null {
  const value = raw.trim();
  if (channel === "email") return z.email().safeParse(value).success ? value.toLowerCase() : null;
  if (channel === "linkedin") return /^urn:li:fsd_profile:[A-Za-z0-9_-]{1,200}$/.test(value) ? value : null;
  if (/^[1-9]\d{6,14}@s\.whatsapp\.net$/.test(value)) return value;
  const phone = value.replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{6,14}$/.test(phone) ? `${phone.slice(1)}@s.whatsapp.net` : null;
}

export function replyDecision(event: { fromIdentity: string; receivedAt: Date }, identities: ReplyIdentity[]) {
  const matches = identities.filter(item => item.identity === event.fromIdentity && event.receivedAt >= item.since);
  const contactIds = [...new Set(matches.map(item => item.contactId))];
  const emails = [...new Set(matches.map(item => item.email.toLowerCase()))];
  // A contact may have several email snapshots; duplicates sharing an email
  // belong to that same identity group. Separate groups are ambiguous.
  const parent = new Map<string, string>();
  const root = (key: string): string => { const value = parent.get(key); return value && value !== key ? root(value) : key; };
  for (const match of matches) parent.set(root(`contact:${match.contactId}`), root(`email:${match.email.toLowerCase()}`));
  const groups = new Set(contactIds.map(id => root(`contact:${id}`)));
  return { action: !matches.length ? "ignore" as const : groups.size > 1 ? "review" as const : "stop" as const, contactIds, emails };
}

export function monitorFresh(monitor: { lastSuccessAt: Date | null; lastError: string | null } | undefined, now = new Date()) {
  if (!monitor?.lastSuccessAt || monitor.lastError) return false;
  const age = now.getTime() - monitor.lastSuccessAt.getTime();
  return age >= 0 && age <= 300_000;
}
