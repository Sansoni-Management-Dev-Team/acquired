import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {campaignDefinition,campaignFirstStepIndex} from '@/domain/campaign';
import {validateNativeSequenceDefinition} from './agent-sequence-tools';
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const selectedSchema=z.object({contactId:uuid,recipient:z.email(),sourceRevision:hash,name:z.string().min(1).max(200),qualificationConfirmed:z.boolean(),fit:z.array(z.object({key:z.string(),status:z.string(),reason:z.string(),sources:z.array(z.string())}))}).strict();
export const reviewedSequenceEnrolmentInput=z.object({sequenceId:uuid,versionId:uuid,version:z.number().int().positive(),definition:campaignDefinition,workflowId:z.string().min(1).nullable(),bindingId:uuid,bindingDigest:hash,selected:z.array(selectedSchema).min(1).max(5)}).strict();
/** Enrolment and initial-send review are separate decisions. A frozen published
 * version keeps its original executor; changing the current feature flag never
 * substitutes another runtime or account. */
export function prepareReviewedSequenceEnrolment(raw:unknown){
 const input=reviewedSequenceEnrolmentInput.parse(raw);validateNativeSequenceDefinition(input.definition);
 if(new Set(input.selected.map(c=>c.contactId)).size!==input.selected.length||new Set(input.selected.map(c=>c.recipient.toLowerCase())).size!==input.selected.length)throw new Error('Exact unique contacts required');
 const selected=input.selected.map(contact=>{const enrolmentId=randomUUID();return {...contact,enrolmentId,stepIndex:campaignFirstStepIndex(input.definition,enrolmentId)};});
 return {...input,selected,runtime:input.workflowId?'n8n' as const:'legacy' as const,initialState:'needs_review' as const,stopReason:'initial_conversation_requires_review' as const,effects:[]};
}
