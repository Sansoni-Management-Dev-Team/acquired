/** Shared safe copy, without server/provider dependencies in the chat client. */
export const AGENT_RESEARCH_BRIEF_REVIEW_PREFIX='Confirm the saved research brief before company discovery.';
export function isAgentResearchBriefReviewNotice(value:unknown):value is string {
 return typeof value==='string'&&(value===AGENT_RESEARCH_BRIEF_REVIEW_PREFIX||value.startsWith(AGENT_RESEARCH_BRIEF_REVIEW_PREFIX+' '));
}
