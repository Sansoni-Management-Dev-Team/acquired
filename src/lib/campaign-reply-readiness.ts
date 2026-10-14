import "server-only";
import { rows, withCampaignDb, type CampaignActor } from "@/db/campaign-client";
import { campaignDefinition } from "@/domain/campaign";
import { campaignChannels } from "@/domain/contact-record";
import { assertContactReplyFresh } from "@/lib/campaign-reply-monitor";
import { replyMonitorMode } from "@/lib/campaign-reply-store";
import { deliveryProvider } from "@/lib/channels/delivery-registry";
import type { ReplyChannel } from "@/domain/campaign-replies";
import {
  ReplyCheckPending,
  replyCheckDiagnostic,
  replyCheckFailure,
} from "@/lib/campaign-reply-status";

// Operator readiness is separate from process/DB health. A running app does not
// imply that coverage or hosted delivery switches permit outreach.
export async function campaignReplyReadiness(actor: CampaignActor) {
  const mode = replyMonitorMode();
  const jobs = await withCampaignDb(actor, (client) =>
    rows<{
      id: string;
      contact_id: string;
      state: string;
      stop_reason: string | null;
      started_at: Date;
      definition: unknown;
      unresolved_attempt?: boolean;
    }>(
      client,
      `SELECT e.id,e.contact_id,e.state,e.stop_reason,e.started_at,v.definition,EXISTS (SELECT 1 FROM campaign_send_attempts a WHERE a.enrolment_id = e.id AND (a.state IN ('claimed','unknown') OR (a.step_index = e.step_index AND a.state = 'sent'))) AS unresolved_attempt FROM campaign_enrolments e
     JOIN campaign_sequence_versions v ON v.id = e.version_id WHERE e.organization_id = $1 AND e.owner_user_id = $2
     AND e.state IN ('active','paused','needs_review') ORDER BY e.started_at,e.id LIMIT 101`,
      [actor.organizationId, actor.userId],
    ),
  );
  const enrolments = [];
  const deliveryFailures = new Map<
    ReplyChannel,
    ReturnType<typeof replyCheckFailure> | null
  >();
  for (const job of jobs.slice(0, 100)) {
    const channels = campaignChannels(campaignDefinition.parse(job.definition));
    let coverage: "ready" | "waiting" | "review" = "ready";
    let diagnostic: ReturnType<typeof replyCheckDiagnostic> | undefined;
    if (mode !== "enforce") coverage = "waiting";
    else
      try {
        await assertContactReplyFresh(
          actor,
          job.contact_id,
          channels,
          job.started_at,
        );
      } catch (error) {
        const failure = replyCheckFailure(error);
        coverage = failure instanceof ReplyCheckPending ? "waiting" : "review";
        diagnostic = replyCheckDiagnostic(failure);
      }
    let delivery: "ready" | "waiting" | "review" = "ready";
    let deliveryDiagnostic: ReturnType<typeof replyCheckDiagnostic> | undefined;
    for (const channel of channels) {
      if (!deliveryFailures.has(channel)) {
        try {
          await deliveryProvider(channel, undefined).ready(actor);
          deliveryFailures.set(channel, null);
        } catch (error) {
          deliveryFailures.set(channel, replyCheckFailure(error, channel));
        }
      }
      const failure = deliveryFailures.get(channel);
      if (failure && delivery !== "review") {
        delivery = failure instanceof ReplyCheckPending ? "waiting" : "review";
        deliveryDiagnostic = replyCheckDiagnostic(failure);
      }
    }
    enrolments.push({
      id: job.id,
      unresolvedAttempt: job.unresolved_attempt ?? false,
      state: job.state,
      channels,
      coverage,
      diagnostic,
      delivery,
      deliveryDiagnostic,
      explicitWaiting:
        job.state === "active" &&
        job.stop_reason === "reply_monitor_wait" &&
        coverage === "waiting",
    });
  }
  const truncated = jobs.length > 100;
  return {
    mode,
    truncated,
    enforceReady:
      mode === "enforce" &&
      !truncated &&
      enrolments.every(
        (job) =>
          job.state !== "active" ||
          job.coverage === "ready" ||
          job.explicitWaiting,
      ),
    recoveryReady:
      mode === "enforce" &&
      !truncated &&
      enrolments.every(
        (job) =>
          job.coverage === "ready" &&
          job.delivery === "ready" &&
          !job.unresolvedAttempt,
      ),
    enrolments,
  };
}
