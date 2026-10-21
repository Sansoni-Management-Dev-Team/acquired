import 'server-only';
import type {CampaignActor} from '@/db/campaign-client';
import {campaignSqlPool} from '@/db/campaign-client';
import type {ConnectionBinding} from '../../communications/packages/contracts/src';
import {configuredAcquireCommunicationsForBinding} from './communications-configuration';
import {actorCommunicationsClient} from './communications-client';
import {resolveRecordedApplicationConnection} from './communications-bindings';
import {CommunicationsSubmissionLedger,type SubmissionLedgerOptions} from './communications-submission-ledger';
export type SubmissionProjectionPorts=Pick<SubmissionLedgerOptions,'pool'|'codec'|'admission'|'client'|'businessClock'>;
/** One shared factory resolves BOTH the original physical runtime and its
 * existing keyring. No mode fallback or duplicate key parsing is introduced. */
export async function configuredSubmissionLedger(actor:CampaignActor,bindingId:string,binding:ConnectionBinding,ports?:SubmissionProjectionPorts){
 if(ports)return new CommunicationsSubmissionLedger({...ports,actor,bindingId,binding});
 const configured=await configuredAcquireCommunicationsForBinding(actor,binding);
 return new CommunicationsSubmissionLedger({actor,bindingId,binding,pool:campaignSqlPool(),codec:configured.applicationCodec,admission:await configured.host.admission(binding),client:await actorCommunicationsClient(actor)});
}
export async function projectSubmittedDraft(actor:CampaignActor,messageId:string,expected:{id:string;sentAt:string}){
 const selected=await resolveRecordedApplicationConnection(actor,'email',{draftId:messageId});if(!selected)throw Error('Original draft binding required');
 const ledger=await configuredSubmissionLedger(actor,selected.bindingId,selected.binding),fact=await ledger.capture({sourceKind:'draft',sourceId:messageId});
 if(fact.status!=='submitted'||fact.effect!=='message'||fact.providerReference!==expected.id||Date.parse(fact.submittedAt)!==Date.parse(expected.sentAt))throw Error('Exact original submitted outcome required');
 return {fact,materialization:await ledger.materializeDraft(messageId)};
}

/** Shared positive fact only: ordinary SDK original lookup authenticates again.
 * Expected metadata is comparison, never a receipt or caller success assertion. */
export async function captureOriginalSubmission(actor:CampaignActor,source:{bindingId:string;binding:ConnectionBinding;sourceKind:'draft'|'campaign'|'agent';sourceId:string},expected:{effect:'message'|'invitation';providerReference:string;submittedAt:string},ports?:SubmissionProjectionPorts){
 const ledger=await configuredSubmissionLedger(actor,source.bindingId,source.binding,ports),fact=await ledger.capture({sourceKind:source.sourceKind,sourceId:source.sourceId});
 if(fact.status!=='submitted'||fact.effect!==expected.effect||fact.providerReference!==expected.providerReference||Date.parse(fact.submittedAt)!==Date.parse(expected.submittedAt))throw Error('Exact original submitted outcome required');return fact;
}
