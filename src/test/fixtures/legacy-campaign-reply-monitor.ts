// Historical scanner characterization fixture only. Production never imports this module.
import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { rows, withCampaignDb, withCampaignWorker, type CampaignActor } from "@/db/campaign-client";
import { monitorFresh, replyIdentity, replyMonitorIssue, type ReplyChannel, type ReplyPage } from "@/domain/campaign-replies";
import { campaignLinkedin, campaignLinkedinAccountStatus, linkedinCampaignEnabled, linkedinProfileFor } from "@/test/fixtures/legacy-campaign-linkedin";
import { whatsappCampaignEnabled, assertCampaignWhatsappConnected, CampaignWhatsappDisconnected } from "@/test/fixtures/campaign-whatsapp";
import { assertReplyMonitorMember, applyCampaignReply, assertNoReplyHold, assertNoSharedReplyHold, replayContactReplies, replyMonitorMode, saveReplyIdentity } from "@/lib/campaign-reply-store";
import { readEmailReplyPage } from "@/test/fixtures/email-reply-reader";
import { collectReplyPages } from "@/test/fixtures/campaign-reply-collector";
import { readChannelReplies } from "@/test/fixtures/campaign-reply-providers";
import { campaignMailboxForConnection } from "@/test/fixtures/campaign-mailbox";
import { connectionCanMonitorReplies } from "@/test/fixtures/gmail-connection";
import { assertCampaignWorkRemaining, campaignWorkDeferred, withCampaignWorkCleanup } from "@/lib/campaign-work-budget";
import { ReplyCheckPending, ReplyCheckReview, replyCheckFailure, replyCheckDiagnostic } from "@/lib/campaign-reply-status";

type MonitorRow = { channel: ReplyChannel; cursor: string | null; account_identity: string | null; last_success_at: Date | null; last_error: string | null; lease_until?: Date | null };
type IdentityRow = { channel: ReplyChannel; identity: string; source_identity: string; email: string; contact_id: string; since: Date };
export type ReplyContact = { id: string; email: string | null; data: Record<string, unknown>; since: Date; requiredChannels: ReplyChannel[] };

export async function prepareReplyContact(actor: CampaignActor, contact: ReplyContact) {
  if(process.env.COMMUNICATIONS_RUNTIME_ENABLED==='true'){await (await import('@/lib/communications-configured-monitor')).refreshConfiguredContact(actor,contact);return;}
  if (replyMonitorMode() === "off") return;
  const existing = await withCampaignDb(actor, client => rows<IdentityRow>(client, "SELECT * FROM campaign_reply_identities WHERE organization_id = $1 AND owner_user_id = $2 AND contact_id = $3", [actor.organizationId, actor.userId, contact.id]));
  const emailRequired = contact.requiredChannels.includes("email");
  const emailMonitored = existing.some(item => item.channel === "email");
  const [mailbox] = contact.email && !emailRequired && !emailMonitored ? await withCampaignDb(actor, client => rows<{ encrypted_refresh_token: string | null; reconnect_required: boolean; scopes: string[] | null }>(client,
    "SELECT encrypted_refresh_token,reconnect_required,scopes FROM mailbox_connections WHERE organization_id = $1 AND user_id = $2 AND provider = 'gmail'", [actor.organizationId, actor.userId])) : [];
  // Replies stop the person even when their sequence only sends on another channel.
  if (emailRequired || (contact.email && (emailMonitored || (mailbox && connectionCanMonitorReplies({ encryptedRefreshToken: mailbox.encrypted_refresh_token, reconnectRequired: mailbox.reconnect_required, scopes: mailbox.scopes }))))) {
    if (!contact.email) throw new Error("Email reply identity is unavailable");
    await saveReplyIdentity(actor, { contactId: contact.id, email: contact.email, channel: "email", identity: contact.email, sourceIdentity: contact.email, since: contact.since });
  }
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
    const verified = existing.find(item => item.channel === "linkedin" && item.source_identity === profile);
    if (verified) {
      if (verified.since > contact.since) await saveReplyIdentity(actor, { contactId: contact.id, email: contact.email, channel: "linkedin", identity: verified.identity, sourceIdentity: profile, since: contact.since });
      return;
    }
    if (!contact.requiredChannels.includes("linkedin") && !existing.some(item => item.channel === "linkedin") && await campaignLinkedinAccountStatus(actor) === "disconnected") return;
    const observed = await campaignLinkedin(actor, { operation: "status", profile });
    if (observed.status === "retry") throw new ReplyCheckPending("identity_pending", "linkedin", new Date(Math.max(Date.now() + 60_000, (observed.nextEligibleAt || 0) * 1000)));
    if (!observed.recipient || !replyIdentity("linkedin", observed.recipient)) throw new ReplyCheckReview("protocol", "linkedin");
    await saveReplyIdentity(actor, { contactId: contact.id, email: contact.email, channel: "linkedin", identity: observed.recipient, sourceIdentity: profile, since: contact.since });
  }
}

async function readEmailReplies(actor: CampaignActor, cursor: string | null): Promise<ReplyPage> {
  const [mailbox] = await withCampaignDb(actor, client => rows<{id:string;address:string;encrypted_refresh_token:string;reconnect_required:boolean;scopes:string[]}>(client,"SELECT * FROM mailbox_connections WHERE organization_id=$1 AND user_id=$2 AND provider='gmail'",[actor.organizationId,actor.userId]));
  if(!mailbox)throw new ReplyCheckReview("reconnect","email");
  return readEmailReplyPage({accountIdentity:`${mailbox.id}:${mailbox.address}`,cursor,
    mailbox:campaignMailboxForConnection({encryptedRefreshToken:mailbox.encrypted_refresh_token,reconnectRequired:mailbox.reconnect_required,scopes:mailbox.scopes},mailbox.id),
    list:after=>withCampaignDb(actor,client=>rows<{identity:string;since:Date}>(client,"SELECT identity,min(since) AS since FROM campaign_reply_identities WHERE organization_id=$1 AND owner_user_id=$2 AND channel='email' AND ($3::text IS NULL OR identity>$3) GROUP BY identity ORDER BY identity LIMIT 2",[actor.organizationId,actor.userId,after])),
    find:addresses=>withCampaignDb(actor,client=>rows<{identity:string;since:Date}>(client,"SELECT identity,min(since) AS since FROM campaign_reply_identities WHERE organization_id=$1 AND owner_user_id=$2 AND channel='email' AND identity=ANY($3::text[]) GROUP BY identity",[actor.organizationId,actor.userId,addresses])),
  });
}

export async function scanReplyChannel(actor: CampaignActor, channel: ReplyChannel, options: { maxPages?: number; refresh?: boolean } = {}) {
  if(process.env.COMMUNICATIONS_RUNTIME_ENABLED==='true')return (await import('@/lib/communications-configured-monitor')).scanConfiguredChannel(actor,channel,options);
  if (replyMonitorMode() === "off") return { complete: false };
  assertCampaignWorkRemaining();
  const token = randomUUID();
  const [monitor] = await withCampaignDb(actor, async client => {
    await client.query("INSERT INTO campaign_reply_monitors (organization_id,owner_user_id,channel) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [actor.organizationId, actor.userId, channel]);
    return rows<MonitorRow>(client, `UPDATE campaign_reply_monitors SET lease_token = $4, lease_until = now() + interval '5 minutes', last_attempt_at = now()
      WHERE organization_id = $1 AND owner_user_id = $2 AND channel = $3 AND (lease_until IS NULL OR lease_until < now()) RETURNING *`, [actor.organizationId, actor.userId, channel, token]);
  });
  if (!monitor) return { complete: false, skipped: true };
  try {
    const [scope] = channel === "linkedin" ? await withCampaignDb(actor, client => rows<{ since: Date | null }>(client,
      `SELECT min(i.since) AS since FROM campaign_reply_identities i WHERE i.organization_id = $1 AND i.owner_user_id = $2 AND i.channel = 'linkedin'
       AND EXISTS (SELECT 1 FROM campaign_enrolments e WHERE e.organization_id = i.organization_id AND e.owner_user_id = i.owner_user_id AND e.contact_id = i.contact_id AND e.state IN ('active','paused','needs_review'))`, [actor.organizationId, actor.userId])) : [];
    return await collectReplyPages({ cursor: monitor.cursor, accountIdentity: monitor.account_identity, maxPages: options.maxPages,
      read: cursor => channel === "email" ? readEmailReplies(actor, cursor) : readChannelReplies(actor, channel, cursor, scope?.since ?? undefined, options),
      commit: page => withCampaignWorkCleanup(() => withCampaignWorker(async client => {
        const [lease] = await rows(client, `SELECT channel FROM campaign_reply_monitors WHERE organization_id = $1 AND owner_user_id = $2 AND channel = $3 AND lease_token = $4 AND lease_until > now() FOR UPDATE`, [actor.organizationId, actor.userId, channel, token]);
        if (!lease) return false;
        await assertReplyMonitorMember(client, actor);
        for (const event of page.events) await applyCampaignReply(client, actor, channel, page.accountIdentity, event);
        await client.query(`UPDATE campaign_reply_monitors SET account_identity = $5, cursor = $6,
          last_success_at = CASE WHEN $7 THEN $8::timestamptz WHEN $11::boolean THEN NULL ELSE last_success_at END, last_error = CASE WHEN $7 AND NOT $10::boolean THEN NULL ELSE $9 END
          WHERE organization_id = $1 AND owner_user_id = $2 AND channel = $3 AND lease_token = $4`, [actor.organizationId, actor.userId, channel, token, page.accountIdentity, page.nextCursor, page.complete, new Date(page.checkedAt), JSON.stringify(replyCheckDiagnostic(new ReplyCheckPending(page.waitReason || "incomplete", channel, page.nextReadAt ? new Date(page.nextReadAt) : undefined, monitor.last_success_at))), Boolean(page.waitReason), page.coverageInvalidated ?? false]);
        return true;
      }, actor.organizationId)),
    });
  } catch (error) {
    const classified = replyCheckFailure(error, channel);
    const failure = classified instanceof ReplyCheckPending
      ? new ReplyCheckPending(classified.code, channel, classified.retryAt, monitor.last_success_at)
      : new ReplyCheckReview(classified.code, channel, monitor.last_success_at);
    const reason = JSON.stringify(replyCheckDiagnostic(campaignWorkDeferred(error) ? new ReplyCheckPending("timeout", channel, undefined, monitor.last_success_at) : failure));
    await withCampaignWorkCleanup(() => withCampaignDb(actor, client => client.query("UPDATE campaign_reply_monitors SET last_error = $5, last_success_at = CASE WHEN $6::boolean THEN NULL ELSE last_success_at END WHERE organization_id = $1 AND owner_user_id = $2 AND channel = $3 AND lease_token = $4", [actor.organizationId, actor.userId, channel, token, reason, failure instanceof ReplyCheckReview && failure.code === "account_changed"]).then(() => undefined)));
    throw campaignWorkDeferred(error) ? error : failure;
  } finally {
    await withCampaignWorkCleanup(() => withCampaignDb(actor, client => client.query("UPDATE campaign_reply_monitors SET lease_token = NULL, lease_until = NULL WHERE organization_id = $1 AND owner_user_id = $2 AND channel = $3 AND lease_token = $4", [actor.organizationId, actor.userId, channel, token]).then(() => undefined)));
  }
}

export async function checkContactReplyMonitors(actor: CampaignActor, contact: ReplyContact) {
  if(process.env.COMMUNICATIONS_RUNTIME_ENABLED==='true'){await (await import('@/lib/communications-configured-monitor')).refreshConfiguredContact(actor,contact);await replayContactReplies(actor,contact.id);return;}
  if (replyMonitorMode() === "off") return;
  try { await prepareReplyContact(actor, contact); }
  catch (error) { if (replyMonitorMode() === "enforce") { if (campaignWorkDeferred(error)) throw error; throw replyCheckFailure(error); } return; }
  // Previously observed replies must stop outreach even if today's provider
  // scan is incomplete or unavailable during activation of enforcement.
  await replayContactReplies(actor, contact.id);
  const identities = await withCampaignDb(actor, client => rows<IdentityRow>(client, "SELECT * FROM campaign_reply_identities WHERE organization_id = $1 AND owner_user_id = $2 AND contact_id = $3", [actor.organizationId, actor.userId, contact.id]));
  const channels = [...new Set<ReplyChannel>([...contact.requiredChannels, ...identities.map(item => item.channel)])];
  for (const channel of channels) {
    // Check on every preflight, including when a previous scan is still fresh.
    // A reply may have arrived since the scheduled scan.
    try { await scanReplyChannel(actor, channel); }
    catch (error) { if (replyMonitorMode() === "enforce") throw error; }
  }
  await replayContactReplies(actor, contact.id);
  if (replyMonitorMode() === "enforce") await assertContactReplyFresh(actor, contact.id, channels, contact.since);
}

export async function assertContactReplyFresh(actor: CampaignActor, contactId: string, required?: ReplyChannel[], since?: Date) {
  if(process.env.COMMUNICATIONS_RUNTIME_ENABLED==='true'){await withCampaignDb(actor,client=>assertReplyCoverage(client,actor,contactId,required,since));await assertNoSharedReplyHold(actor,contactId);return;}
  if (replyMonitorMode() !== "enforce") return;
  await withCampaignDb(actor, client => assertReplyCoverage(client, actor, contactId, required, since));
  await assertNoSharedReplyHold(actor, contactId);
}

// Recovery uses this inside its transaction after locking the enrolment. Share
// locks fence identity invalidation and scanner commits until recovery commits.
export async function assertReplyCoverage(client: PoolClient, actor: CampaignActor, contactId: string, required?: ReplyChannel[], since?: Date) {

  await assertNoReplyHold(client, actor, contactId);
  if(process.env.COMMUNICATIONS_RUNTIME_ENABLED==='true') {
    if(!required?.length||!since)throw new ReplyCheckPending('incomplete');
    const [current]=await rows<{ready:boolean}>(client,`SELECT count(DISTINCT b.channel)::integer=$5 AS ready FROM public.campaign_channel_bindings cb JOIN public.campaign_enrolments e ON e.id=cb.enrolment_id JOIN public.communication_bindings b ON b.id=cb.binding_id JOIN public.communication_reply_monitors m ON m.binding_id=b.id JOIN public.communication_consumer_checkpoints p ON p.binding_id=m.binding_id AND p.scope_digest=m.scope_digest WHERE e.organization_id=$1 AND e.owner_user_id=$2 AND e.contact_id=$3 AND e.state IN('active','paused','needs_review') AND b.channel=ANY($4::text[]) AND b.authority='service' AND b.backend='unipile' AND m.complete AND m.initial_sync_complete AND NOT m.invalidated AND m.coverage_from<=$6::timestamptz AND m.coverage_through>=$6::timestamptz AND m.coverage_through>=clock_timestamp()-interval '5 minutes' AND m.coverage_through<=m.observed_at AND m.observed_at<=clock_timestamp() AND m.observed_at>=clock_timestamp()-interval '5 minutes'`,[actor.organizationId,actor.userId,contactId,required,new Set(required).size,since]);
    if(current?.ready!==true)throw new ReplyCheckPending('incomplete');return;
  }
  const identities = await rows<IdentityRow>(client, "SELECT * FROM campaign_reply_identities WHERE organization_id = $1 AND owner_user_id = $2 AND contact_id = $3 FOR SHARE", [actor.organizationId, actor.userId, contactId]);
  const monitors = await rows<MonitorRow>(client, "SELECT * FROM campaign_reply_monitors WHERE organization_id = $1 AND owner_user_id = $2 FOR SHARE", [actor.organizationId, actor.userId]);
  for (const channel of new Set<ReplyChannel>([...(required || []), ...identities.map(item => item.channel)])) {
    const monitor = monitors.find(item => item.channel === channel);
    const issue = replyMonitorIssue(monitor?.last_error);
    if (monitor?.last_error && !issue && !/incomplete|deferred/i.test(monitor.last_error)) throw new ReplyCheckReview("reconnect", channel, monitor.last_success_at);
    if (issue?.category === "review") throw new ReplyCheckReview(issue.code, channel, monitor?.last_success_at);
    if (monitor?.lease_until && monitor.lease_until > new Date()) throw new ReplyCheckPending("busy", channel, new Date(Math.min(monitor.lease_until.getTime(), Date.now() + 60_000)), monitor.last_success_at);
    if (!identities.some(item => item.channel === channel && (!since || item.since <= since)) || !monitorFresh(monitor ? { lastSuccessAt: monitor.last_success_at, lastError: monitor.last_error } : undefined)) {
      const retryAt = issue?.category === "retry" && issue.retryAt && new Date(issue.retryAt).getTime() > Date.now() ? new Date(issue.retryAt) : undefined;
      throw new ReplyCheckPending(issue?.category === "retry" ? issue.code : "stale", channel, retryAt, monitor?.last_success_at);
    }
  }
}

export async function runReplyMonitorTick(limit = 3) {
  const result = { scanned: 0, complete: 0, incomplete: 0, failed: 0, skipped: 0, deferred: 0 };
  if (replyMonitorMode() === "off") return result;
  const jobs = await withCampaignWorker(client => rows<{ organization_id: string; owner_user_id: string; channel: ReplyChannel; due_soon: boolean }>(client,
    `SELECT i.organization_id,i.owner_user_id,i.channel,m.last_attempt_at,bool_or(e.state = 'active' AND e.next_step_at <= now() + interval '5 minutes') AS due_soon FROM campaign_reply_identities i
     JOIN campaign_enrolments e ON e.organization_id = i.organization_id AND e.owner_user_id = i.owner_user_id AND e.contact_id = i.contact_id
     LEFT JOIN campaign_reply_monitors m ON m.organization_id = i.organization_id AND m.owner_user_id = i.owner_user_id AND m.channel = i.channel
     WHERE e.state IN ('active','paused','needs_review') AND (m.last_attempt_at IS NULL OR m.last_attempt_at <= now() - interval '55 seconds')
     GROUP BY i.organization_id,i.owner_user_id,i.channel,m.last_attempt_at
     ORDER BY due_soon DESC,m.last_attempt_at NULLS FIRST,i.organization_id,i.owner_user_id,i.channel LIMIT $1`, [limit]));
  for (const [index, job] of jobs.entries()) {
    try {
      assertCampaignWorkRemaining();
      const scan = await scanReplyChannel({ organizationId: job.organization_id, userId: job.owner_user_id }, job.channel, { maxPages: 1, refresh: job.due_soon ?? false });
      if ("skipped" in scan && scan.skipped) { result.skipped++; continue; }
      result.scanned++;
      if ("deferred" in scan && scan.deferred) result.deferred++;
      else if (scan.complete) result.complete++;
      else result.incomplete++;
    } catch (error) {
      if (campaignWorkDeferred(error)) { result.deferred += jobs.length - index; break; }
      result.scanned++; result.failed++;
    }
  }
  return result;
}

// Scheduler maintenance shares account scans; delivery preflight above always
// performs its own fresh read. Replay is required even if identity discovery or
// today's inbox scan fails, including after observation-to-enforcement changes.
export async function prepareScheduledReplyContact(actor: CampaignActor, contact: ReplyContact) {
  if(process.env.COMMUNICATIONS_RUNTIME_ENABLED==='true'){await (await import('@/lib/communications-configured-monitor')).refreshConfiguredContact(actor,contact);await replayContactReplies(actor,contact.id);return;}
  await replayContactReplies(actor, contact.id);
  await prepareReplyContact(actor, contact);
}

export async function checkScheduledReplyContact(actor: CampaignActor, contact: ReplyContact) {
  if(process.env.COMMUNICATIONS_RUNTIME_ENABLED==='true'){await (await import('@/lib/communications-configured-monitor')).refreshConfiguredContact(actor,contact);await replayContactReplies(actor,contact.id);return;}
  await replayContactReplies(actor, contact.id);
  await assertContactReplyFresh(actor, contact.id, contact.requiredChannels, contact.since);
}
