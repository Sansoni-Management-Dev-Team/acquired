import "server-only";
import type { PoolClient } from "pg";
import { rows, withCampaignDb, withCampaignWorker, type CampaignActor } from "@/db/campaign-client";
import type { ReplyChannel } from "@/domain/campaign-replies";
import { assertNoReplyHold, assertNoSharedReplyHold, replayContactReplies, replyMonitorMode } from "@/lib/campaign-reply-store";
import { assertCampaignWorkRemaining, campaignWorkDeferred } from "@/lib/campaign-work-budget";
import { ReplyCheckPending, ReplyCheckReview } from "@/lib/campaign-reply-status";

export type ReplyContact = { id: string; email: string | null; data: Record<string, unknown>; since: Date; requiredChannels: ReplyChannel[] };

function requireConfiguredRuntime(channel?: ReplyChannel): void {
  if (process.env.COMMUNICATIONS_RUNTIME_ENABLED !== 'true') throw new ReplyCheckReview('delivery_disabled', channel);
}

export async function prepareReplyContact(actor: CampaignActor, contact: ReplyContact) {
  requireConfiguredRuntime();
  await (await import('./communications-configured-monitor')).refreshConfiguredContact(actor, contact);
}

export async function scanReplyChannel(actor: CampaignActor, channel: ReplyChannel, options: { maxPages?: number; refresh?: boolean } = {}) {
  requireConfiguredRuntime(channel);
  return (await import('./communications-configured-monitor')).scanConfiguredChannel(actor, channel, options);
}

export async function checkContactReplyMonitors(actor: CampaignActor, contact: ReplyContact) {
  // Durable replies must continue stopping a person when today's service read fails.
  await replayContactReplies(actor, contact.id);
  await prepareReplyContact(actor, contact);
  await replayContactReplies(actor, contact.id);
}

export async function assertContactReplyFresh(actor: CampaignActor, contactId: string, required?: ReplyChannel[], since?: Date) {
  requireConfiguredRuntime();
  await withCampaignDb(actor, client => assertReplyCoverage(client, actor, contactId, required, since));
  await assertNoSharedReplyHold(actor, contactId);
}

// Recovery checks the same recorded bindings and consumer checkpoints as delivery.
// Historical scanner rows cannot certify current communications coverage.
export async function assertReplyCoverage(client: PoolClient, actor: CampaignActor, contactId: string, required?: ReplyChannel[], since?: Date) {
  await assertNoReplyHold(client, actor, contactId);
  requireConfiguredRuntime();
  if (!required?.length || !since) throw new ReplyCheckPending('incomplete');
  const [current] = await rows<{ ready: boolean }>(client, `SELECT count(DISTINCT b.channel)::integer=$5 AS ready FROM public.campaign_channel_bindings cb JOIN public.campaign_enrolments e ON e.id=cb.enrolment_id JOIN public.communication_bindings b ON b.id=cb.binding_id JOIN public.communication_reply_monitors m ON m.binding_id=b.id JOIN public.communication_consumer_checkpoints p ON p.binding_id=m.binding_id AND p.scope_digest=m.scope_digest WHERE e.organization_id=$1 AND e.owner_user_id=$2 AND e.contact_id=$3 AND e.state IN('active','paused','needs_review') AND b.channel=ANY($4::text[]) AND b.authority='service' AND b.backend='unipile' AND m.complete AND m.initial_sync_complete AND NOT m.invalidated AND m.coverage_from<=$6::timestamptz AND m.coverage_through>=$6::timestamptz AND m.coverage_through>=clock_timestamp()-interval '5 minutes' AND m.coverage_through<=m.observed_at AND m.observed_at<=clock_timestamp() AND m.observed_at>=clock_timestamp()-interval '5 minutes'`, [actor.organizationId, actor.userId, contactId, required, new Set(required).size, since]);
  if (current?.ready !== true) throw new ReplyCheckPending('incomplete');
}

export async function runReplyMonitorTick(limit = 3) {
  const result = { scanned: 0, complete: 0, incomplete: 0, failed: 0, skipped: 0, deferred: 0 };
  if (process.env.COMMUNICATIONS_RUNTIME_ENABLED !== 'true' || replyMonitorMode() === 'off') return result;
  const jobs = await withCampaignWorker(client => rows<{ organization_id: string; owner_user_id: string; channel: ReplyChannel; due_soon: boolean }>(client,
    `SELECT w.organization_id,w.owner_user_id,w.channel,bool_or(e.state='active' AND e.next_step_at<=now()+interval '5 minutes') AS due_soon
     FROM public.campaign_channel_bindings w
     JOIN public.campaign_enrolments e ON e.id=w.enrolment_id AND e.organization_id=w.organization_id AND e.owner_user_id=w.owner_user_id
     JOIN public.communication_bindings b ON b.id=w.binding_id AND b.organization_id=w.organization_id AND b.owner_user_id=w.owner_user_id
     LEFT JOIN public.communication_reply_monitors m ON m.binding_id=b.id
     WHERE e.state IN('active','paused','needs_review') AND b.authority='service' AND b.backend='unipile'
     GROUP BY w.organization_id,w.owner_user_id,w.channel
     ORDER BY min(m.observed_at) NULLS FIRST,w.organization_id,w.owner_user_id,w.channel LIMIT $1`, [limit]));
  for (const [index, job] of jobs.entries()) {
    try {
      assertCampaignWorkRemaining();
      const scan = await scanReplyChannel({ organizationId: job.organization_id, userId: job.owner_user_id }, job.channel, { maxPages: 1, refresh: job.due_soon ?? false });
      if ('skipped' in scan && scan.skipped) { result.skipped++; continue; }
      result.scanned++;
      if (scan.complete) result.complete++;
      else result.incomplete++;
    } catch (error) {
      if (campaignWorkDeferred(error)) { result.deferred += jobs.length - index; break; }
      result.scanned++; result.failed++;
    }
  }
  return result;
}

export async function prepareScheduledReplyContact(actor: CampaignActor, contact: ReplyContact) {
  await checkContactReplyMonitors(actor, contact);
}

export async function checkScheduledReplyContact(actor: CampaignActor, contact: ReplyContact) {
  await checkContactReplyMonitors(actor, contact);
}
