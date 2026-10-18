import {agentGuidanceSnapshotSchema,type AgentGuidanceSnapshot} from './agent-guidance-snapshot';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {briefSchema,briefToMandate,criterion,searchReadiness,type AcquisitionBrief} from '@/domain/acquisition';
import {publicResearchUrl,researchStartSchema} from '@/domain/research';
const identity=z.object({responsibilityId:z.string().uuid(),responsibilityRevision:z.number().int().positive(),mandateRevision:z.string().regex(/^\d{1,30}$/)}).strict();
const inputSchema=identity.extend({brief:briefSchema,researchJobId:z.string().uuid(),guidance:agentGuidanceSnapshotSchema.optional()}).strict();
export function agentResearchContextRevision(value:z.infer<typeof identity>&{guidance?:AgentGuidanceSnapshot}){const {guidance,...scope}=value;const i=identity.parse(scope);return createHash('sha256').update(JSON.stringify({...i,...(guidance?{guidance}:{})})).digest('hex');}
export const agentResearchPlanSchema=identity.extend({
 nativeResearchPlanVersion:z.literal(1),guidance:agentGuidanceSnapshotSchema.optional(),contextRevision:z.string().regex(/^[a-f0-9]{64}$/),
 config:researchStartSchema,
 execution:z.object({pipeline:z.literal('firmable-company-v1'),backgroundResearch:z.literal(false),peopleResearch:z.literal(false)}).strict(),
 providerPolicy:z.object({version:z.literal(1),requestCeilingMicroUsd:z.literal('1000000'),maxAttempts:z.object({search:z.literal(6),page:z.literal(5),ai:z.literal(5),firmable:z.literal(60)}).strict()}).strict(),
 qualificationCriteria:z.array(z.object({key:z.string(),state:z.enum(['specified','unknown','unrestricted']),value:z.string().max(1500),confirmed:z.boolean(),importance:z.enum(['requirement','preference'])}).strict()).max(30),
}).strict();
export type AgentResearchPlan=z.infer<typeof agentResearchPlanSchema>;
/** No inference or provider call. Missing confirmed scope returns to the human.
 * The config is a proposal; its approved:true field is the existing worker
 * request shape and does not grant permission to dispatch it. */
export function buildAgentResearchPlan(raw:{brief:AcquisitionBrief;researchJobId:string;responsibilityId:string;responsibilityRevision:number;mandateRevision:string;guidance?:AgentGuidanceSnapshot}):AgentResearchPlan{
 const {brief,researchJobId,guidance,...scope}=inputSchema.parse(raw);
 if(searchReadiness(brief).length)throw new Error('Confirm the saved subsectors and geography before research.');
 const subsectors=criterion(brief,'subsectors');
 if(subsectors.state!=='specified'||subsectors.value.trim().length<2||subsectors.value.trim().length>960)throw new Error('Confirm a specific research scope of at most 960 characters.');
 const states=briefToMandate(brief).states;if(!states.length)throw new Error('Confirm Australian states or National before research.');
 const researchScope=subsectors.value.trim(),targetBusinesses=20;
 const config=researchStartSchema.parse({requestId:researchJobId,seeds:[...new Set((brief.researchSources??[]).map(publicResearchUrl).filter((s):s is string=>Boolean(s)))],searchTerms:researchScope.split(/[;\n]/).map(s=>s.trim().slice(0,160)).filter(s=>s.length>=2).slice(0,6),researchScope,geography:states.length===8?'National':states.join(', '),discover:true,strategy:'discover',workflow:'business',mode:'automatic',targetBusinesses,findPeople:true,peopleSearchesPerCompany:2,peopleBudget:{maxCompanies:targetBusinesses,maxPages:12},companyBudget:{maxCompanies:2,maxPages:3},approved:true,budget:{maxPages:5,maxDomains:5,maxMinutes:10,maxModelCalls:5}});
 return agentResearchPlanSchema.parse({...scope,...(guidance?{guidance}:{}),nativeResearchPlanVersion:1,execution:{pipeline:'firmable-company-v1',backgroundResearch:false,peopleResearch:false},providerPolicy:{version:1,requestCeilingMicroUsd:'1000000',maxAttempts:{search:6,page:5,ai:5,firmable:60}},contextRevision:agentResearchContextRevision({...scope,guidance}),config,qualificationCriteria:brief.criteria.map(({key,state,value,confirmed,importance})=>({key,state,value,confirmed,importance}))});
}
