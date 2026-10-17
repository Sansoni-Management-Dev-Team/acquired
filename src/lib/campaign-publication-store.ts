import type {PoolClient,QueryResultRow} from 'pg';
import type {CampaignActor} from '@/db/campaign-client';
import {campaignDefinition} from '@/domain/campaign';
import {CampaignError} from './campaign-error';
type Reader=<T extends QueryResultRow>(client:PoolClient,sql:string,values?:unknown[])=>Promise<T[]>;
const queryRows:Reader=async(client,sql,values=[])=> (await client.query(sql,values)).rows;
export type CampaignPublicationInput={sequenceId:string;draftRevision:string;publishedVersion:number;versionId:string;workflowId:string|null;updatedAt?:Date};
/** Shared final pin. Provider provisioning is outside this transaction; the
 * reviewed base revision and version counter are checked again under row lock. */
export async function commitCampaignPublication(client:PoolClient,actor:CampaignActor,input:CampaignPublicationInput,rows:Reader=queryRows){
 const [sequence]=await rows<{id:string;draft:unknown;draft_revision:string;published_version:number;updated_at:Date}>(client,'SELECT *,xmin::text AS draft_revision FROM campaign_sequences WHERE id = $3 AND organization_id = $1 AND owner_user_id = $2 FOR UPDATE',[actor.organizationId,actor.userId,input.sequenceId]);
 if(!sequence)throw new CampaignError('Sequence not found',404);
 if(sequence.draft_revision!==input.draftRevision||sequence.published_version!==input.publishedVersion||input.updatedAt&&sequence.updated_at.getTime()!==input.updatedAt.getTime())throw new CampaignError('Sequence changed during publishing; try again');
 const definition=campaignDefinition.parse(sequence.draft),version=sequence.published_version+1;
 const [snapshot]=await rows<{id:string}>(client,'INSERT INTO campaign_sequence_versions (id, organization_id, owner_user_id, sequence_id, version, definition, n8n_workflow_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',[input.versionId,actor.organizationId,actor.userId,input.sequenceId,version,JSON.stringify(definition),input.workflowId]);
 const saved=await client.query('UPDATE campaign_sequences SET published_version = $2, updated_at = now() WHERE id = $1 RETURNING xmin::text AS draft_revision',[input.sequenceId,version]);
 return {id:snapshot.id,version,draftRevision:saved.rows[0]?.draft_revision as string|undefined,n8nWorkflowId:input.workflowId,localDevelopment:process.env.LOCAL_DEVELOPMENT==='true'};
}
