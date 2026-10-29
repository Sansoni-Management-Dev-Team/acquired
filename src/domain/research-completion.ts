/** New finite workloads finish from their saved items, not elapsed wall time.
 * Historical and reviewed plans retain the completion policy they approved. */
export type ResearchCompletionConfig={completionPolicy?:'work-items';automaticDeadline?:number;budget?:{maxMinutes:number}};
export function completesWorkItems(config:unknown){return Boolean(config&&typeof config==='object'&&'completionPolicy' in config&&config.completionPolicy==='work-items');}
export function researchDeadline(config:ResearchCompletionConfig,createdAt?:number){
 if(completesWorkItems(config))return Infinity;
 return Math.min(config.automaticDeadline??Infinity,createdAt!==undefined&&config.budget?createdAt+config.budget.maxMinutes*60000:Infinity);
}
/** One callback attempt. Queue age and previous attempts never consume it. */
export const COMPANY_FIELD_ATTEMPT_MS=90_000;
