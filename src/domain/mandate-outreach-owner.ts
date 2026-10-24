export const agentManagedOutreachReason = 'The agent manages outreach for this mandate. Sequence subscriptions are unavailable to avoid overlapping messages. Manage conversations in agent chat.';

export type MandateOutreachOwner = 'agent'|'sequences'|'research-only';
export const researchOnlyOutreachReason = 'Research only: this run finds and enriches companies and people. No outreach is sent for this run.';
export function mandateOutreachRestrictionReason(owner:MandateOutreachOwner){return owner==='research-only'?researchOnlyOutreachReason:agentManagedOutreachReason;}
