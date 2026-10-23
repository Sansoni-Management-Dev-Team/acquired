import{z}from'zod';
const actions=['draft','wait','stop','handoff','review']as const,kinds=['initial_email','reply_email','follow_up_email','initial_whatsapp','reply_whatsapp','follow_up_whatsapp','initial_linkedin','reply_linkedin','follow_up_linkedin','invitation_linkedin']as const;
const paths=['decision','decision.action','decision.draft','decision.draft.kind','decision.draft.intent','decision.draft.routeId','decision.draft.subject','decision.draft.body','decision.draft.rationale','decision.draft.sourceIds','decision.draft.sourceIds[]','decision.reason','decision.summary','decision.sourceIds','decision.sourceIds[]','decision.reminder','decision.reminder.wakeAt','decision.reminder.timeZone','decision.reminder.reason','other']as const;
const codes=['invalid_type','too_big','too_small','invalid_value','invalid_format','invalid_union','unrecognized_keys','custom','not_multiple_of','invalid_key','invalid_element','other']as const;
export const agentModelResponseFailureSchema=z.object({version:z.literal(1),category:z.enum(['schema_validation','invalid_json','incomplete_response','usage_invalid']),action:z.enum(actions).optional(),draftKind:z.enum(kinds).optional(),issues:z.array(z.object({path:z.enum(paths),code:z.enum(codes),maximum:z.number().int().min(0).max(1000000).optional(),length:z.number().int().min(0).max(1000000).optional()}).strict()).max(10).optional()}).strict();
/** Never retain issue messages, unknown keys, field values or model prose. */
export function summariseAgentModelValidationFailure(error:z.ZodError,raw:unknown,category:'schema_validation'|'usage_invalid'='schema_validation'){
 const get=(value:unknown,key:string):unknown=>{if(!value||typeof value!=='object')return undefined;const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&'value'in descriptor?descriptor.value:undefined;};
 const decision=get(raw,'decision'),action=get(decision,'action'),draftKind=get(get(decision,'draft'),'kind');
 const flattened:Record<string,unknown>[]=[];let visited=0;
 const visit=(issues:readonly unknown[],depth=0,prefix:unknown[]=[])=>{if(depth>6)return;for(const value of issues){if(++visited>100)break;if(!value||typeof value!=='object')continue;const issue=value as Record<string,unknown>,path=[...prefix,...(Array.isArray(issue.path)?issue.path:[])];if(issue.code==='invalid_union'&&Array.isArray(issue.errors)){for(const nested of issue.errors)if(Array.isArray(nested))visit(nested,depth+1,path);}else flattened.push({...issue,path});}};visit(error.issues);
 const issues=flattened.sort((a,b)=>Number(b.code==='too_big')-Number(a.code==='too_big')).slice(0,10).map(issue=>{
  const rawPath=Array.isArray(issue.path)?issue.path:[],candidate=rawPath.map(value=>typeof value==='number'?'[]':typeof value==='string'?value:'?').join('.').replaceAll('.[]','[]');
  const path=paths.includes(candidate as typeof paths[number])?candidate as typeof paths[number]:'other',code=codes.includes(issue.code as typeof codes[number])?issue.code as typeof codes[number]:'other';
  let value:unknown=raw;if(path!=='other')for(const part of rawPath){if(typeof part!=='string'&&typeof part!=='number'){value=undefined;break;}value=get(value,String(part));}
  const length=typeof value==='string'||Array.isArray(value)?Math.min(value.length,1000000):undefined;
  const maximum=typeof issue.maximum==='number'&&Number.isSafeInteger(issue.maximum)&&issue.maximum>=0&&issue.maximum<=1000000?issue.maximum:undefined;
  return{path,code,...(maximum===undefined?{}:{maximum}),...(length===undefined?{}:{length})};
 });
 return agentModelResponseFailureSchema.parse({version:1,category,...(actions.includes(action as typeof actions[number])?{action}:{}),...(kinds.includes(draftKind as typeof kinds[number])?{draftKind}:{}),issues});
}
