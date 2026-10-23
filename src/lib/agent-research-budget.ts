import{z}from'zod';
import{agentResearchPlanSchema}from'./agent-research-plan';
const count=z.number().int().min(0).max(30000),policy=z.object({requestCeilingMicroUsd:z.literal('1000000'),maxAttempts:z.object({search:count,page:count,ai:count,firmable:count}),perCompany:z.object({search:count,page:count}).optional()});
export type ResearchPhaseExposure={calls:string;usdMicro:string;perRequestMicro:string;windowMinutes?:number;callAdmission?:'per_request';reserveCalls?:string;peoplePerRequestMicro?:string;usdAdmission?:'company_phase_people_per_request'};
export function researchPhaseExposure(op:{name:string;input:unknown}):ResearchPhaseExposure{
 if(!['research.start','research.people','research.fields'].includes(op.name))throw Error('Reviewed research phase required');
 const configured=z.object({providerPolicy:z.object({version:z.union([z.literal(2),z.literal(3)])})}).safeParse(op.input);
 if(configured.success){
  const plan=agentResearchPlanSchema.parse(op.input);if(op.name!=='research.start'||![4,5].includes(plan.config.companyDiscoveryPolicy?.version??0)||![2,3].includes(plan.providerPolicy.version))throw Error('Exact configured company-only research phase required');
  const p=plan.providerPolicy;if(p.version===1)throw Error('Configured research policy required');const calls=Object.values(p.maxAttempts).reduce((a,b)=>a+BigInt(b),BigInt(0)),usd=Object.entries(p.maxAttempts).reduce((sum,[provider,attempts])=>sum+BigInt(attempts)*BigInt(p.requestCeilingsMicroUsd[provider as keyof typeof p.requestCeilingsMicroUsd]),BigInt(0));
  return{calls:String(calls),usdMicro:p.version===3?'11000000':String(usd),perRequestMicro:p.requestCeilingMicroUsd,...(p.version===3?{peoplePerRequestMicro:p.requestCeilingMicroUsd,usdAdmission:p.usdAdmission}:{}),windowMinutes:17,callAdmission:'per_request',reserveCalls:'1'};
 }
 const input=z.object({providerPolicy:policy,selected:z.array(z.unknown()).min(1).max(5).optional()}).parse(op.input),p=input.providerPolicy,attempts={...p.maxAttempts};
 if(op.name==='research.fields'){if(!p.perCompany||!input.selected)throw Error('Exact public-field selection required');attempts.search=Math.min(attempts.search,p.perCompany.search*input.selected.length);attempts.page=Math.min(attempts.page,p.perCompany.page*input.selected.length);}
 const calls=BigInt(Object.values(attempts).reduce((a,b)=>a+b,0));if(calls<=BigInt(0))throw Error('Finite physical research phase required');return{calls:String(calls),usdMicro:String(calls*BigInt(p.requestCeilingMicroUsd)),perRequestMicro:p.requestCeilingMicroUsd};
}
export type ResearchPhaseFunding={ready:boolean;exposure:ResearchPhaseExposure;scopes:Array<{scope:'organization'|'user'|'mandate';unit:'calls'|'usd_micro';needed:string;available:string;shortfall:string;windowCoversPhase:boolean}>};
export function researchPhaseFunding(actor:{organizationId:string;userId:string;mandateId:string},exposure:ResearchPhaseExposure,accounts:Array<{scope_key:string;unit:string;cap:string;spent:string;reserved:string;window_start:string|Date;window_end:string|Date}>,now=Date.now()):ResearchPhaseFunding{
 const scopes:ResearchPhaseFunding['scopes']=[];for(const[scope,prefix]of[['organization','organization'],['user','user:'+actor.userId],['mandate','mandate:'+actor.mandateId]]as const)for(const unit of['calls','usd_micro']as const){const a=accounts.filter(a=>a.scope_key===prefix+':'+unit&&a.unit===unit&&new Date(a.window_start).getTime()<=now&&new Date(a.window_end).getTime()>now).sort((a,b)=>new Date(b.window_start).getTime()-new Date(a.window_start).getTime())[0],needed=BigInt(unit==='calls'?(exposure.reserveCalls??exposure.calls):exposure.usdMicro),available=a?BigInt(a.cap)-BigInt(a.spent)-BigInt(a.reserved):BigInt(0),windowCoversPhase=Boolean(a&&new Date(a.window_end).getTime()>=now+(exposure.windowMinutes??12)*60000);scopes.push({scope,unit,needed:String(needed),available:String(available>BigInt(0)?available:BigInt(0)),shortfall:String(needed>available?needed-available:BigInt(0)),windowCoversPhase});}
 return{ready:scopes.every(s=>s.shortfall==='0'&&s.windowCoversPhase),exposure,scopes};
}
