import {z} from 'zod';

export const emptyAgentTargetText='No cached contacts are currently eligible for a new conversation. Review missing contact data, mandate fit, prior outreach or ownership holds.';
const count=z.number().int().min(0).max(1000000);
const detailsSchema=z.object({
 counts:z.object({contacts:count,companies:count,reviewed:count,selected:z.literal(0),excluded:count}),
 excluded:z.array(z.object({contactId:z.string().uuid(),reasons:z.array(z.string().min(1).max(100)).min(1).max(30)})).max(50),
});
const rowSchema=z.object({role:z.literal('assistant'),request_key:z.string().regex(/^target-empty:(?:[a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i),content:z.object({text:z.literal(emptyAgentTargetText),details:detailsSchema})});
/** Display only: no eligibility decisions, source changes or transcript writes. */
export function emptyAgentTargetNotice(raw:unknown){
 const parsed=rowSchema.safeParse(raw);if(!parsed.success)return;
 const {counts,excluded}=parsed.data.content.details;
 if(counts.excluded!==counts.reviewed||excluded.length!==Math.min(50,counts.excluded)||new Set(excluded.map(p=>p.contactId)).size!==excluded.length)return;
 const allFit=counts.reviewed>0&&counts.reviewed<=50&&excluded.every(person=>person.reasons.includes('excluded_by_mandate_review'));
 const allBrief=counts.reviewed>0&&counts.reviewed<=50&&excluded.every(person=>person.reasons.includes('company_criteria_review_required'));
 const text=allBrief?'Review the saved mandate brief and confirm its geography and business type, including any testing assumptions, before starting outreach. I haven’t started any new conversations. Other company-fit or contact checks may still need review after the brief is confirmed.':allFit?`None of the ${counts.reviewed} contacts checked match this mandate’s requirements. I haven’t started outreach. Review the company matches or try another demo.`:counts.reviewed?`The ${counts.reviewed} contacts checked aren’t ready for outreach. I haven’t started any new conversations. Review their company fit and contact details before trying again.`:'There are no contacts ready for new outreach. Review the saved companies and people before trying again.';
 const signature=JSON.stringify({counts,excluded:excluded.map(person=>({contactId:person.contactId,reasons:[...person.reasons].sort()})).sort((a,b)=>a.contactId.localeCompare(b.contactId))});
 return {text,signature};
}
