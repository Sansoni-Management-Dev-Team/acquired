import "server-only";
import { rows, withCampaignDb, type CampaignActor } from "@/db/campaign-client";
import { DEFAULT_CAMPAIGN_NAME, defaultCampaignDefinition } from "@/domain/default-campaign";

export async function ensureDefaultCampaign(actor: CampaignActor, mandateId: string) {
  await withCampaignDb(actor, async client => {
    // Serialize first visits for this owner and mandate until the transaction commits.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [JSON.stringify(["default-campaign", actor.organizationId, actor.userId, mandateId])]);
    const existing = await rows<{ id: string }>(client, "SELECT id FROM campaign_sequences WHERE organization_id = $1 AND owner_user_id = $2 AND mandate_id = $3 LIMIT 1", [actor.organizationId, actor.userId, mandateId]);
    if (existing.length) return;
    await client.query("INSERT INTO campaign_sequences (organization_id, owner_user_id, mandate_id, name, draft) VALUES ($1, $2, $3, $4, $5)", [actor.organizationId, actor.userId, mandateId, DEFAULT_CAMPAIGN_NAME, JSON.stringify(defaultCampaignDefinition())]);
  });
}
