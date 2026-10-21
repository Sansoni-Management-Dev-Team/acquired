import {z} from 'zod';
import type {ResearchConfig} from './research';
import {companyDiscoveryProgress} from './company-discovery-progress';

const issue=z.object({version:z.literal(1),provider:z.enum(['firmable','web']),category:z.enum(['reconnect_required','authentication_or_policy','rate_limit_unspecified','domain_backoff','reader_busy','origin_rate_limit','page_unavailable','provider_error','transport','timeout']),status:z.number().int().min(400).max(599).optional()}).strict();
export type InitialResearchBlocker={code:'firmable_reconnect_required'|'firmable_unavailable'|'web_backoff'|'research_interrupted'|'research_budget_limited'|'research_deadline'|'company_identity_review'|'research_incomplete';message:string};
export type InitialResearchOutcome={candidates:number;companies:number;people:number;blocker?:InitialResearchBlocker};
function record(value:unknown):Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function count(value:unknown){return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:0;}
/** Read-only presentation from saved structured observations. Raw error prose,
 * provider bodies and current connection state never establish a past cause. */
export function initialResearchOutcome(input:{status:string;config:ResearchConfig;companies:number;people:number}):InitialResearchOutcome{
 const raw=record(input.config),result=record(raw.hybridResult??raw.webFirmableResult??raw.firmableResult);
 const candidates=companyDiscoveryProgress(input.config).candidates||count(result.candidates);
 const outcome:InitialResearchOutcome={candidates,companies:count(input.companies),people:count(input.people)};
 if(!['partial','failed'].includes(input.status))return outcome;
 const issues=(Array.isArray(raw.operationalIssues)?raw.operationalIssues:[]).map(value=>issue.safeParse(value)).flatMap(value=>value.success?[value.data]:[]);
 const pages=Object.values(record(raw.webSearchPages)).map(record);
 const backoff=issues.some(value=>value.provider==='web'&&['domain_backoff','reader_busy','origin_rate_limit','rate_limit_unspecified'].includes(value.category))||pages.some(value=>value.ok===false&&['domain_backoff','reader_busy','origin_rate_limit','rate_limit_unspecified'].includes(String(value.category)));
 if(issues.some(value=>value.provider==='firmable'&&value.category==='reconnect_required'))outcome.blocker={code:'firmable_reconnect_required',message:'The saved Firmable connection needs renewal before company profiles can be retrieved.'};
 else if(issues.some(value=>value.provider==='firmable'))outcome.blocker={code:'firmable_unavailable',message:'Firmable company retrieval was unavailable. Its saved failure must be resolved before retrying.'};
 else if(result.stopReason==='interrupted'||count(result.interrupted)>0)outcome.blocker={code:'research_interrupted',message:'Company profile retrieval was interrupted.'+(backoff?' Web discovery also encountered temporary reader backoff.':'')};
 else if(result.stopReason==='web_budget_limited')outcome.blocker={code:'research_budget_limited',message:'Research stopped at its saved provider budget limit.'};
 else if(result.stopReason==='deadline')outcome.blocker={code:'research_deadline',message:'Research reached its time limit before all profiles could be retrieved.'};
 else if(count(result.identityReviewRequired)>0)outcome.blocker={code:'company_identity_review',message:'Some company identities need review before their profiles can be saved.'};
 else if(backoff)outcome.blocker={code:'web_backoff',message:'Web discovery encountered temporary reader backoff.'};
 else outcome.blocker={code:'research_incomplete',message:'Some research work did not finish. Review the saved results and operational status before retrying.'};
 return outcome;
}
