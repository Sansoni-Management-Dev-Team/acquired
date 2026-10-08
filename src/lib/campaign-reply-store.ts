import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { rows, withCampaignDb, withCampaignWorker, type CampaignActor } from "@/db/campaign-client";
import { replyDecision, replyIdentity, replyEventSchema, type ReplyChannel, type ReplyEvent } from "@/domain/campaign-replies";

export function replyMonitorMode(): "off" | "observe" | "enforce" {
  const mode = process.env.CAMPAIGN_REPLY_MONITOR_MODE;
  return mode === "observe" || mode === "enforce" ? mode : "off";
}

export async function assertNoReplyHold(client: PoolClient, actor: CampaignActor, contactId: string) {
  if (replyMonitorMode() !== "enforce") return;
  const [hold] = await rows<{ reason: string }>(client, "SELECT reason FROM campaign_reply_holds WHERE organization_id = $1 AND contact_id = $2", [actor.organizationId, contactId]);
  if (hold) throw new Error(`Contact is held: ${hold.reason}`);
}

export async function saveReplyIdentity(actor: CampaignActor, input: { contactId: string; email: string | null; channel: ReplyChannel; identity: string; sourceIdentity: string; since: Date }) {
  if (replyMonitorMode() === "off") return;
  const normalized = replyIdentity(input.channel, input.identity);
  if (!normalized) throw new Error("Invalid reply identity");
  await withCampaignDb(actor, async client => {
    const inserted = await client.query(`INSERT INTO campaign_reply_identities (organization_id, owner_user_id, contact_id, channel, identity, source_identity, email, since)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (organization_id,owner_user_id,contact_id,channel,identity,email) DO NOTHING`,
    [actor.organizationId, actor.userId, input.contactId, input.channel, normalized, input.sourceIdentity, input.email || "", input.since]);
    const earlier = await client.query(`UPDATE campaign_reply_identities SET since = $7 WHERE organization_id = $1 AND owner_user_id = $2 AND contact_id = $3 AND channel = $4 AND identity = $5 AND email = $6 AND since > $7`,
    [actor.organizationId, actor.userId, input.contactId, input.channel, normalized, input.email || "", input.since]);
    if (inserted.rowCount || earlier.rowCount) await client.query(`UPDATE campaign_reply_monitors SET last_success_at = NULL, lease_token = NULL, lease_until = NULL, cursor = CASE WHEN channel = 'email' THEN NULL ELSE cursor END WHERE organization_id = $1 AND owner_user_id = $2 AND channel = $3`, [actor.organizationId, actor.userId, input.channel]);
  });
}

// Runs inside the caller's transaction: the receipt, deduplication, contact hold,
// stop and audit commit together. A page checkpoint must use this same client.
export async function applyCampaignReply(client: PoolClient, actor: CampaignActor, channel: ReplyChannel, accountIdentity: string, raw: ReplyEvent) {
  const event = replyEventSchema.parse(raw);
  const identity = replyIdentity(channel, event.fromIdentity);
  if (!identity) throw new Error("Invalid reply identity");
  const receivedAt = new Date(event.receivedAt);
  await client.query(`INSERT INTO campaign_reply_receipts (organization_id,owner_user_id,channel,account_identity,provider_event_id,from_identity,received_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [actor.organizationId, actor.userId, channel, accountIdentity, event.id, identity, receivedAt]);
  const identities = await rows<{ contact_id: string; email: string; identity: string; since: Date }>(client,
    `SELECT i.contact_id,i.email,i.identity,i.since FROM campaign_reply_identities i WHERE i.organization_id = $1 AND i.channel = $3 AND i.identity = $4
     AND EXISTS (SELECT 1 FROM campaign_reply_identities own WHERE own.organization_id = $1 AND own.owner_user_id = $2 AND own.channel = $3 AND own.identity = $4)`, [actor.organizationId, actor.userId, channel, identity]);
  const decision = replyDecision({ fromIdentity: identity, receivedAt }, identities.map(item => ({ contactId: item.contact_id, email: item.email, identity: item.identity, since: item.since })));
  if (decision.action === "ignore") return decision.action;
  const providerId = createHash("sha256").update(JSON.stringify([actor.organizationId, accountIdentity, event.id])).digest("hex");
  for (const contactId of decision.contactIds) {
    // Include contactId so duplicate records for the same person can each carry
    // an audit event while provider replay remains idempotent for every contact.
    const inserted = await client.query(`INSERT INTO campaign_inbound_events (organization_id,owner_user_id,contact_id,channel,provider_event_id,from_identity,received_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [actor.organizationId, actor.userId, contactId, channel, `${providerId}:${contactId}`, identity, receivedAt]);
    if (!inserted.rowCount) continue;
    if (replyMonitorMode() === "observe") {
      await client.query("INSERT INTO audit_events (organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,'campaign.reply_observed','contact',$3,$4)", [actor.organizationId, actor.userId, contactId, JSON.stringify({ channel, receivedAt: event.receivedAt, decision: decision.action })]);
    }
  }
  if (replyMonitorMode() !== "enforce") return decision.action;
  const reason = decision.action === "review" ? "reply_identity_ambiguous" : "reply_received";
  // Holds are replayed even if the event was already observed. This allows an
  // observation-to-enforcement rollout without losing replies collected earlier.
  for (const contactId of decision.contactIds) await client.query(`INSERT INTO campaign_reply_holds (organization_id,contact_id,channel,provider_event_id,received_at,reason)
    VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (organization_id,contact_id) DO NOTHING`, [actor.organizationId, contactId, channel, providerId, receivedAt, reason]);
  // Preserve the existing email hold as well, including for duplicate contact
  // rows that have not been registered yet. Ambiguous identities only hold the
  // candidate contacts for review; they do not assert a confirmed email reply.
  if (decision.action === "stop") for (const email of decision.emails) await client.query("INSERT INTO campaign_contact_holds (organization_id,email,reason) VALUES ($1,$2,'reply_received') ON CONFLICT (organization_id,email) DO NOTHING", [actor.organizationId, email]);
  await client.query(`WITH stopped AS (UPDATE campaign_enrolments SET state = $4, stop_reason = $5, next_step_at = NULL, updated_at = now()
    WHERE organization_id = $1 AND (contact_id = ANY($2::uuid[]) OR ($4 = 'stopped' AND recipient_email = ANY($3::text[]))) AND state IN ('active','paused','needs_review') AND stop_reason IS DISTINCT FROM $5
    RETURNING id,owner_user_id) INSERT INTO audit_events (organization_id,actor_id,action,entity_type,entity_id,metadata)
    SELECT $1,owner_user_id,'campaign.reply_received','campaign_enrolment',id,jsonb_build_object('channel',$6::text,'receivedAt',$7::text,'reason',$5::text) FROM stopped`,
  [actor.organizationId, decision.contactIds, decision.emails, decision.action === "stop" ? "stopped" : "needs_review", reason, channel, event.receivedAt]);
  return decision.action;
}

// Membership is visible only to the scoped user role. Keep this check in the
// worker transaction, then restore its restricted role before applying a page.
export async function assertReplyMonitorMember(client: PoolClient, actor: CampaignActor) {
  await client.query("SET LOCAL ROLE acquire_campaign_user");
  try {
    await client.query("SELECT set_config('app.acquire_org', $1, true), set_config('app.acquire_user', $2, true)", [actor.organizationId, actor.userId]);
    const [member] = await rows(client, "SELECT 1 FROM member WHERE organization_id = $1 AND user_id = $2", [actor.organizationId, actor.userId]);
    if (!member) throw new Error("Reply monitor owner is no longer a member");
  } finally {
    await client.query("SET LOCAL ROLE acquire_campaign_worker");
  }
}

export async function ingestCampaignReply(actor: CampaignActor, channel: ReplyChannel, accountIdentity: string, event: ReplyEvent) {
  if (replyMonitorMode() === "off") throw new Error("Reply monitor is disabled");
  if (!replyIdentity(channel, event.fromIdentity)) throw new Error("Invalid reply identity");
  return withCampaignWorker(async client => {
    await assertReplyMonitorMember(client, actor);
    const [monitor] = await rows<{ account_identity: string | null }>(client, "SELECT account_identity FROM campaign_reply_monitors WHERE organization_id = $1 AND owner_user_id = $2 AND channel = $3", [actor.organizationId, actor.userId, channel]);
    if (monitor?.account_identity && monitor.account_identity !== accountIdentity) throw new Error("Reply monitor account changed; review the connection");
    return applyCampaignReply(client, actor, channel, accountIdentity, event);
  });
}

export async function replayContactReplies(actor: CampaignActor, contactId: string) {
  if (replyMonitorMode() === "off") return;
  await withCampaignWorker(async client => {
    const receipts = await rows<{ channel: ReplyChannel; account_identity: string; provider_event_id: string; from_identity: string; received_at: Date }>(client,
      `SELECT DISTINCT r.* FROM campaign_reply_receipts r JOIN campaign_reply_identities i ON i.organization_id = r.organization_id AND i.owner_user_id = r.owner_user_id AND i.channel = r.channel AND i.identity = r.from_identity
       WHERE i.organization_id = $1 AND i.owner_user_id = $2 AND i.contact_id = $3 AND r.received_at >= i.since ORDER BY r.received_at LIMIT 501`, [actor.organizationId, actor.userId, contactId]);
    if (receipts.length > 500) throw new Error("Reply history requires review before sending");
    for (const receipt of receipts) await applyCampaignReply(client, actor, receipt.channel, receipt.account_identity, { id: receipt.provider_event_id, fromIdentity: receipt.from_identity, receivedAt: receipt.received_at.toISOString() });
  });
}

export async function assertNoSharedReplyHold(actor: CampaignActor, contactId: string) {
  if (replyMonitorMode() !== "enforce") return;
  await withCampaignWorker(async client => {
    const [hold] = await rows(client, `SELECT h.reason FROM campaign_reply_identities own JOIN campaign_reply_identities linked ON linked.organization_id = own.organization_id AND linked.channel = own.channel AND linked.identity = own.identity
      JOIN campaign_reply_holds h ON h.organization_id = linked.organization_id AND h.contact_id = linked.contact_id
      WHERE own.organization_id = $1 AND own.owner_user_id = $2 AND own.contact_id = $3 LIMIT 1`, [actor.organizationId, actor.userId, contactId]);
    if (hold) throw new Error("Contact shares a replied identity; review before sending");
  });
}
