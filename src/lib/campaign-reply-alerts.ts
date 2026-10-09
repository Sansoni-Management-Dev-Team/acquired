import "server-only";
import type { PoolClient } from "pg";
import { rows, withCampaignDb, type CampaignActor } from "@/db/campaign-client";
import type { CampaignReplyAlert } from "@/domain/campaign-reply-alerts";

// Existing stop audits are durable notifications. Reading them never scans a
// provider or sends outreach, and the user role enforces owner/organisation scope.
export async function listCampaignReplyAlerts(actor: CampaignActor): Promise<CampaignReplyAlert[]> {
  return withCampaignDb(actor, client => readCampaignReplyAlerts(client, actor));
}

export async function readCampaignReplyAlerts(client: PoolClient, actor: CampaignActor): Promise<CampaignReplyAlert[]> {
    const alerts = await rows<Omit<CampaignReplyAlert, "receivedAt"> & { receivedAt: Date }>(client, `
      SELECT * FROM (
        SELECT DISTINCT ON (e.contact_id) a.id::text AS id, e.contact_id AS "contactId",
          COALESCE(NULLIF(c.display_name,''),e.recipient_email,'Unnamed person') AS "contactName",
          e.mandate_id AS "mandateId", COALESCE(a.metadata->>'channel','email') AS channel,
          COALESCE((a.metadata->>'receivedAt')::timestamptz,a.created_at) AS "receivedAt",
          e.stop_reason = 'reply_identity_ambiguous' AS "needsReview", a.created_at AS "detectedAt"
        FROM audit_events a
        JOIN campaign_enrolments e ON e.id::text = a.entity_id AND e.organization_id = a.organization_id
        JOIN contacts c ON c.id = e.contact_id AND c.organization_id = e.organization_id
        WHERE a.organization_id = $1 AND a.actor_id = $2 AND e.owner_user_id = $2
          AND a.entity_type = 'campaign_enrolment' AND a.action = 'campaign.reply_received'
          AND e.stop_reason IN ('reply_received','reply_identity_ambiguous')
        ORDER BY e.contact_id,a.created_at DESC,a.id DESC
      ) replies ORDER BY "detectedAt" DESC LIMIT 50`, [actor.organizationId, actor.userId]);
    return alerts.map(({ id, contactId, contactName, mandateId, channel, receivedAt, needsReview }) => ({ id, contactId, contactName, mandateId, channel, receivedAt: receivedAt.toISOString(), needsReview }));
}
