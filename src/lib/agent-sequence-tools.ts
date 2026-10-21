import {containsAgentOutboundLink} from '@/domain/agent-execution';
import {campaignDraftDefinition,campaignDefinition,campaignStepEntries} from '@/domain/campaign';
/** Pure validation/preview of the same complete builder schema. A preview cannot
 * save, publish, enroll, select an account or call n8n. */
export function previewAgentSequenceDraft(raw:unknown){
 const definition=campaignDraftDefinition.parse(raw),published=campaignDefinition.safeParse(definition);
 return {definition,publishable:published.success,issues:published.success?[]:published.error.issues.map(issue=>issue.message),steps:campaignStepEntries(definition).length,effects:[]};
}

/** Native V1 keeps email-first and human booking handoff boundaries. The main
 * builder still supports its existing full schema and original runtime. */
export function validateNativeSequenceDefinition(raw:unknown){const definition=campaignDefinition.parse(raw),entries=campaignStepEntries(definition);if(entries.some(({step})=>!['email','wait'].includes(step.kind)))throw new Error('Agent V1 supports email sequences only; use the full builder for other channels');if(entries.some(({step})=>step.kind==='email'&&(containsAgentOutboundLink(step.subject)||containsAgentOutboundLink(step.body))))throw new Error('Booking and other outbound links require a human handoff');return definition;}
