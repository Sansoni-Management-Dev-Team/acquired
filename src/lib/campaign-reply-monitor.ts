import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { rows, withCampaignDb, withCampaignWorker, type CampaignActor } from "@/db/campaign-client";
import { monitorFresh, replyIdentity, type ReplyChannel, type ReplyPage } from "@/domain/campaign-replies";
import { campaignLinkedin, campaignLinkedinAccountStatus, linkedinCampaignEnabled, linkedinProfileFor } from "@/lib/campaign-linkedin";
import { whatsappCampaignEnabled, assertCampaignWhatsappConnected, CampaignWhatsappDisconnected } from "@/lib/campaign-whatsapp";
import { assertReplyMonitorMember, applyCampaignReply, assertNoReplyHold, assertNoSharedReplyHold, replayContactReplies, replyMonitorMode, saveReplyIdentity } from "@/lib/campaign-reply-store";
import { collectReplyPages } from "@/lib/campaign-reply-collector";
import { readChannelReplies } from "@/lib/campaign-reply-providers";
import { campaignMailboxForConnection } from "@/lib/campaign-mailbox";

type MonitorRow = { channel: ReplyChannel; cursor: string | null; account_identity: string | null; last_success_at: Date | null; last_error: string | null };
type IdentityRow = { channel: ReplyChannel; identity: string; source_identity: string; email: string; contact_id: string; since: Date };
export type ReplyContact = { id: string; email: string; data: Record<string, unknown>; since: Date; requiredChannels: ReplyChannel[] };

export async function prepareReplyContact(actor: CampaignActor, contact: ReplyContact) {
  if (replyMonitorMode() === "off") return;
  const existing = await withCampaignDb(actor, client => rows<IdentityRow>(client, "SELECT * FROM campaign_reply_identities WHERE organization_id = $1 AND owner_user_id = $2 AND contact_id = $3", [actor.organizationId, actor.userId, contact.id]));
  await saveReplyIdentity(actor, { contactId: contact.id, email: contact.email, channel: "email", identity: contact.email, sourceIdentity: contact.email, since: contact.since });
  const phone = typeof contact.data.phone === "string" ? replyIdentity("whatsapp", contact.data.phone) : null;
  if (phone && whatsappCampaignEnabled()) {
    // A configured service does not mean every sender has connected an account.
    // Discover optional accounts once; previously monitored accounts stay required.
    if (contact.requiredChannels.includes("whatsapp") || existing.some(item => item.channel === "whatsapp")) await assertCampaignWhatsappConnected(actor);
    else { try { await assertCampaignWhatsappConnected(actor); } catch (error) { if (error instanceof CampaignWhatsappDisconnected) return prepareLinkedin(); throw error; } }
    await saveReplyIdentity(actor, { contactId: contact.id, email: contact.email, channel: "whatsapp", identity: phone, sourceIdentity: phone, since: contact.since });
  } else if (contact.requiredChannels.includes("whatsapp")) throw new Error("WhatsApp reply identity or service is unavailable");
  await prepareLinkedin();
  async function prepareLinkedin() {
    let profile: string;
    try { profile = linkedinProfileFor(contact.data); }
    catch { if (contact.requiredChannels.includes("linkedin")) throw new Error("LinkedIn reply identity is unavailable"); return; }
    if (!linkedinCampaignEnabled()) { if (contact.requiredChannels.includes("linkedin")) throw new Error("LinkedIn reply monitor is not configured"); return; }
    if (existing.some(item => item.channel === "linkedin" && item.source_identity === profile)) return;
    if (!contact.requiredChannels.includes("linkedin") && !existing.some(item => item.channel === "linkedin") && await campaignLinkedinAccountStatus(actor) === "disconnected") return;
    const observed = await campaignLinkedin(actor, { operation: "status", profile });
    if (!observed.recipient || !replyIdentity("linkedin", observed.recipient)) throw new Error("LinkedIn reply identity could not be verified; retry after account reads become available");
    await saveReplyIdentity(actor, { contactId: contact.id, email: contact.email, channel: "linkedin", identity: observed.recipient, sourceIdentity: profile, since: contact.since });
  }
}

const emailCursor = z.object({ signature: z.string(), offset: z.number().int().min(0).max(100), watermark: z.iso.datetime().nullable(), scanStartedAt: z.iso.datetime().nullable() }).strict();
async function readEmailReplies(actor: CampaignActor, cursor: string | null): Promise<ReplyPage> {
  const loaded = await withCampaignDb(actor, async client => {
    const [mailbox] = await rows<{ id: string; address: string; encrypted_refresh_token: string; reconnect_required: boolean; scopes: string[] }>(client, "SELECT * FROM mailbox_connections WHERE organization_id = $1 AND user_id = $2 AND provider = 'gmail'", [actor.organizationId, actor.userId]);
    if (!mailbox) throw new Error("Email reply monitor needs a connected Gmail account");
    const identities = await rows<{ identity: string; since: Date }>(client, "SELECT identity,min(since) AS since FROM campaign_reply_identities WHERE organization_id = $1 AND owner_user_id = $2 AND channel = 'email' GROUP BY identity ORDER BY identity LIMIT 101", [actor.organizationId, actor.userId]);
    if (identities.length > 100) throw new Error("Email reply scan exceeds account scan limit; review before sending");
    return { mailbox, identities };
  });
  const gmail = campaignMailboxForConnection({ encryptedRefreshToken: loaded.mailbox.encrypted_refresh_token, reconnectRequired: loaded.mailbox.reconnect_required, scopes: loaded.mailbox.scopes }, loaded.mailbox.id);
  const signature = createHash("sha256").update(JSON.stringify(loaded.identities.map(item => [item.identity, item.since.toISOString()]))).digest("hex");
  const previous = cursor ? emailCursor.parse(JSON.parse(cursor)) : null;
  const checkpoint = previous?.signature === signature ? previous : { signature, offset: 0, watermark: null, scanStartedAt: null };
  const checkedAt = checkpoint.scanStartedAt || new Date().toISOString();
  const events = [] as ReplyPage["events"];
  const batch = loaded.identities.slice(checkpoint.offset, checkpoint.offset + 10);
  for (const identity of batch) {
    const since = checkpoint.watermark ? new Date(Math.max(identity.since.getTime(), new Date(checkpoint.watermark).getTime() - 120_000)) : identity.since;
    const incoming = await gmail.inboundFrom(identity.identity, since);
    events.push(...incoming.map(item => ({ id: item.id, fromIdentity: identity.identity, receivedAt: item.receivedAt.toISOString() })));
    if (events.length > 500) throw new Error("Email reply history requires review");
  }
  const offset = checkpoint.offset + batch.length;
  const complete = offset >= loaded.identities.length;
  return { accountIdentity: `${loaded.mailbox.id}:${loaded.mailbox.address}`, events, nextCursor: JSON.stringify({ signature, offset: complete ? 0 : offset, watermark: complete ? checkedAt : checkpoint.watermark, scanStartedAt: complete ? null : checkedAt }), complete, checkedAt };
}

export async function scanReplyChannel(actor: CampaignActor, channel: ReplyChannel) {
  if (replyMonitorMode() === "off") return { complete: false };
  const token = randomUUID();
  const [monitor] = await withCampaignDb(actor, async client => {
    await client.query("INSERT INTO campaign_reply_monitors (organization_id,owner_user_id,channel) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [actor.organizationId, actor.userId, channel]);
    return rows<MonitorRow>(client, `UPDATE campaign_reply_monitors SET lease_token = $4, lease_until = now() + interval '5 minutes', last_success_at = NULL, last_attempt_at = now()
      WHERE organization_id = $1 AND owner_user_id = $2 AND channel = $3 AND (lease_until IS NULL OR lease_until < now()) RETURNING *`, [actor.organizationId, actor.userId, channel, token]);
  });
  if (!monitor) return { complete: false };
  try {
    const [scope] = channel === "linkedin" ? await withCampaignDb(actor, client => rows<{ since: Date | null }>(client,
      `SELECT min(i.since) AS since FROM campaign_reply_identities i WHERE i.organization_id = $1 AND i.owner_user_id = $2 AND i.channel = 'linkedin'
       AND EXISTS (SELECT 1 FROM campaign_enrolments e WHERE e.organization_id = i.organization_id AND e.owner_user_id = i.owner_user_id AND e.contact_id = i.contact_id AND e.state IN ('active','paused','needs_review'))`, [actor.organizationId, actor.userId])) : [];
    return await collectReplyPages({ cursor: monitor.cursor, accountIdentity: monitor.account_identity,
      read: cursor => channel === "email" ? readEmailReplies(actor, cursor) : readChannelReplies(actor, channel, cursor, scope?.since ?? undefined),
      commit: page => withCampaignWorker(async client => {
        const [lease] = await rows(client, `SELECT channel FROM campaign_reply_monitors WHERE organization_id = $1 AND owner_user_id = $2 AND channel = $3 AND lease_token = $4 AND lease_until > now() FOR UPDATE`, [actor.organizationId, actor.userId, channel, token]);
        if (!lease) return false;
        await assertReplyMonitorMember(client, actor);
        for (const event of page.events) await applyCampaignReply(client, actor, channel, page.accountIdentity, event);
        await client.query(`UPDATE campaign_reply_monitors SET account_identity = $5, cursor = $6,
          last_success_at = CASE WHEN $7 THEN $8 ELSE NULL END, last_error = CASE WHEN $7 THEN NULL ELSE 'Inbox scan incomplete' END
          WHERE organization_id = $1 AND owner_user_id = $2 AND channel = $3 AND lease_token = $4`, [actor.organizationId, actor.userId, channel, token, page.accountIdentity, page.nextCursor, page.complete, new Date(page.checkedAt)]);
        return true;
      }),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 250) : "Reply scan failed";
    await withCampaignDb(actor, client => client.query("UPDATE campaign_reply_monitors SET last_error = $5 WHERE organization_id = $1 AND owner_user_id = $2 AND channel = $3 AND lease_token = $4", [actor.organizationId, actor.userId, channel, token, reason]).then(() => undefined));
    throw error;
  } finally {
    await withCampaignDb(actor, client => client.query("UPDATE campaign_reply_monitors SET lease_token = NULL, lease_until = NULL WHERE organization_id = $1 AND owner_user_id = $2 AND channel = $3 AND lease_token = $4", [actor.organizationId, actor.userId, channel, token]).then(() => undefined));
  }
}

export async function checkContactReplyMonitors(actor: CampaignActor, contact: ReplyContact) {
  if (replyMonitorMode() === "off") return;
  try { await prepareReplyContact(actor, contact); }
  catch (error) { if (replyMonitorMode() === "enforce") throw error; return; }
  const identities = await withCampaignDb(actor, client => rows<IdentityRow>(client, "SELECT * FROM campaign_reply_identities WHERE organization_id = $1 AND owner_user_id = $2 AND contact_id = $3", [actor.organizationId, actor.userId, contact.id]));
  const channels = [...new Set<ReplyChannel>([...contact.requiredChannels, ...identities.map(item => item.channel)])];
  for (const channel of channels) {
    // Check on every preflight, including when a previous scan is still fresh.
    // A reply may have arrived since the scheduled scan.
    try { await scanReplyChannel(actor, channel); }
    catch (error) { if (replyMonitorMode() === "enforce") throw error; }
  }
  await replayContactReplies(actor, contact.id);
  if (replyMonitorMode() === "enforce") await assertContactReplyFresh(actor, contact.id, channels);
}

export async function assertContactReplyFresh(actor: CampaignActor, contactId: string, required?: ReplyChannel[]) {
  if (replyMonitorMode() !== "enforce") return;
  await withCampaignDb(actor, async client => {
    await assertNoReplyHold(client, actor, contactId);
    const identities = await rows<IdentityRow>(client, "SELECT * FROM campaign_reply_identities WHERE organization_id = $1 AND owner_user_id = $2 AND contact_id = $3", [actor.organizationId, actor.userId, contactId]);
    const monitors = await rows<MonitorRow>(client, "SELECT * FROM campaign_reply_monitors WHERE organization_id = $1 AND owner_user_id = $2", [actor.organizationId, actor.userId]);
    for (const channel of new Set<ReplyChannel>(["email", ...(required || []), ...identities.map(item => item.channel)])) {
      const monitor = monitors.find(item => item.channel === channel);
      if (!identities.some(item => item.channel === channel) || !monitorFresh(monitor ? { lastSuccessAt: monitor.last_success_at, lastError: monitor.last_error } : undefined)) throw new Error(`${channel} reply monitoring is stale or disconnected; outreach held for review`);
    }
  });
  await assertNoSharedReplyHold(actor, contactId);
}

export async function runReplyMonitorTick(limit = 3) {
  if (replyMonitorMode() === "off") return { scanned: 0, failed: 0 };
  const jobs = await withCampaignWorker(client => rows<{ organization_id: string; owner_user_id: string; channel: ReplyChannel }>(client,
    `SELECT DISTINCT i.organization_id,i.owner_user_id,i.channel,m.last_attempt_at FROM campaign_reply_identities i
     JOIN campaign_enrolments e ON e.organization_id = i.organization_id AND e.owner_user_id = i.owner_user_id AND e.contact_id = i.contact_id
     LEFT JOIN campaign_reply_monitors m ON m.organization_id = i.organization_id AND m.owner_user_id = i.owner_user_id AND m.channel = i.channel
     WHERE e.state IN ('active','paused','needs_review') AND (m.last_attempt_at IS NULL OR m.last_attempt_at < now() - interval '1 minute')
     ORDER BY m.last_attempt_at NULLS FIRST,i.organization_id,i.owner_user_id,i.channel LIMIT $1`, [limit]));
  let failed = 0;
  for (const job of jobs) { try { await scanReplyChannel({ organizationId: job.organization_id, userId: job.owner_user_id }, job.channel); } catch { failed++; } }
  return { scanned: jobs.length, failed };
}
