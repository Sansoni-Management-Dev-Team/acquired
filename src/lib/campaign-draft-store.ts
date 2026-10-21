import type {PoolClient,QueryResultRow} from 'pg';
import type {CampaignActor} from '@/db/campaign-client';
type RowReader=<T extends QueryResultRow>(client:PoolClient,sql:string,values?:unknown[])=>Promise<T[]>;
const queryRows:RowReader=async(client,sql,values=[])=> (await client.query(sql,values)).rows;
import type {CampaignDefinition} from '@/domain/campaign';
import {CampaignError} from './campaign-error';
export type CampaignDraftRow={id:string;organization_id:string;owner_user_id:string;mandate_id:string;name:string;draft:unknown;published_version:number;updated_at:Date;draft_revision:string};
/** Existing builder and reviewed agent draft commands share these statements.
 * Caller owns the membership/gate transaction; neither primitive publishes,
 * enrolls, schedules or contacts a provider. Full draft schemas are validated
 * at the respective command boundary (incomplete builder layouts stay valid). */
export async function createCampaignDraft(client:PoolClient,actor:CampaignActor,mandateId:string,name:string,definition:CampaignDefinition,stableId?:string,rows:RowReader=queryRows){
 const [mandate]=await rows<{id:string}>(client,'SELECT id FROM mandates WHERE id = $1 AND organization_id = $2',[mandateId,actor.organizationId]);
 if(!mandate)throw new CampaignError('Mandate not found',404);
 const [sequence]=stableId?await rows<CampaignDraftRow>(client,'INSERT INTO campaign_sequences (organization_id, owner_user_id, mandate_id, name, draft, id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *,xmin::text AS draft_revision',[actor.organizationId,actor.userId,mandateId,name,JSON.stringify(definition),stableId]):await rows<CampaignDraftRow>(client,'INSERT INTO campaign_sequences (organization_id, owner_user_id, mandate_id, name, draft) VALUES ($1, $2, $3, $4, $5) RETURNING *,xmin::text AS draft_revision',[actor.organizationId,actor.userId,mandateId,name,JSON.stringify(definition)]);
 return {...sequence,draftRevision:sequence.draft_revision};
}
export async function saveCampaignDraft(client:PoolClient,actor:CampaignActor,sequenceId:string,name:string,definition:CampaignDefinition,expectedRevision?:string,rows:RowReader=queryRows){
 const [current]=await rows<CampaignDraftRow>(client,'SELECT *,xmin::text AS draft_revision FROM campaign_sequences WHERE id=$3 AND organization_id=$1 AND owner_user_id=$2 FOR UPDATE',[actor.organizationId,actor.userId,sequenceId]);
 if(!current)throw new CampaignError('Sequence not found',404);
 if(!expectedRevision||current.draft_revision!==expectedRevision)throw new CampaignError('Sequence changed. Your local edits are kept; reload and review the saved draft before saving.',409);
 const [sequence]=await rows<CampaignDraftRow>(client,'UPDATE campaign_sequences SET name = $4, draft = $5, updated_at = now() WHERE id = $3 AND organization_id = $1 AND owner_user_id = $2 AND xmin::text=$6 RETURNING *,xmin::text AS draft_revision',[actor.organizationId,actor.userId,sequenceId,name,JSON.stringify(definition),expectedRevision]);
 if(!sequence)throw new CampaignError('Sequence changed; reload and review before saving.',409);
 return {...sequence,draftRevision:sequence.draft_revision};
}
