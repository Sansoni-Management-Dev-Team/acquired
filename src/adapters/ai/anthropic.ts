import {z} from 'zod';
import {traceOperation,updateOperationTrace} from '../../../communications/packages/core/src/operation-trace';
import {AiCompletionError,type AiFailureCategory,type AiRejection} from './errors';
import type {AiCompletionRequest,AiCompletionOptions,AiCompletionResult,AiCompletionUsage} from './types';

type Json=Record<string,unknown>;
const object=(value:unknown):Json=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Json:{};
const count=(value:unknown):value is number=>Number.isSafeInteger(value)&&(value as number)>=0&&(value as number)<=1000000;
const constraints=new Set(['minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','minLength','maxLength','pattern','maxItems','uniqueItems']);
const formats=new Set(['date-time','time','date','duration','email','hostname','uri','ipv4','ipv6','uuid']);
/** Only the wire grammar is relaxed. The original schema remains authoritative.
 * See Anthropic structured outputs, reviewed 2026-10-24. */
function wireSchema(raw:Json):Json {
 const result:Json={},notes:string[]=[];
 for(const[key,value]of Object.entries(raw)){
  if(key==='$schema')continue;
  if(constraints.has(key)||(key==='minItems'&&value!==0&&value!==1)||(key==='format'&&!formats.has(String(value)))){notes.push(`${key}: ${JSON.stringify(value)}`);continue;}
  if(['properties','$defs','definitions'].includes(key)){result[key]=Object.fromEntries(Object.entries(object(value)).map(([name,child])=>[name,wireSchema(object(child))]));continue;}
  if(['anyOf','allOf','oneOf'].includes(key)&&Array.isArray(value)){result[key==='oneOf'?'anyOf':key]=value.map(child=>wireSchema(object(child)));continue;}
  if(['items','additionalProperties'].includes(key)&&value!==null&&typeof value==='object'){if(key==='additionalProperties')throw new AiCompletionError('unsupported_request','rejected');result[key]=wireSchema(object(value));continue;}
  if(key==='$ref'&&(typeof value!=='string'||!value.startsWith('#/')))throw new AiCompletionError('unsupported_request','rejected');
  result[key]=value;
 }
 if(raw.type==='object'||raw.properties){if(raw.additionalProperties===true)throw new AiCompletionError('unsupported_request','rejected');result.additionalProperties=false;}
 if(notes.length)result.description=[typeof raw.description==='string'?raw.description:'',`Required application constraints: ${notes.join('; ')}`].filter(Boolean).join('\n');
 return result;
}
function normalizeUsage(raw:unknown):AiCompletionUsage {
 const value=object(raw),read=value.cache_read_input_tokens===undefined?0:value.cache_read_input_tokens,write=value.cache_creation_input_tokens===undefined?0:value.cache_creation_input_tokens;
 if(!count(value.input_tokens)||!count(value.output_tokens)||!count(read)||!count(write))throw new AiCompletionError('usage_invalid','response');
 const creation=object(value.cache_creation),five=creation.ephemeral_5m_input_tokens,one=creation.ephemeral_1h_input_tokens;
 if(write>0&&(!count(five)||!count(one)||five+one!==write)||value.cache_creation!==undefined&&(!count(five)||!count(one)||five+one!==write))throw new AiCompletionError('usage_invalid','response');
 // No tools, geographic premium, batch, or priority service are requested. An
 // unexpected billable category cannot be silently priced as ordinary tokens.
 if(Object.values(object(value.server_tool_use)).some(v=>v!==0)||value.inference_geo!==undefined&&value.inference_geo!=='global'||value.service_tier!==undefined&&value.service_tier!=='standard')throw new AiCompletionError('usage_invalid','response');
 const total=value.input_tokens+read+write;if(!count(total)||total===0)throw new AiCompletionError('usage_invalid','response');
 return {inputTokens:total,outputTokens:value.output_tokens,cachedInputTokens:read,cacheWriteTokens:write,...(value.cache_creation===undefined?{}:{cacheWrite5mTokens:five as number,cacheWrite1hTokens:one as number})};
}
function rejection(status:number,payload:Json):AiCompletionError {
 const error=object(payload.error),type=error.type;
 // Message text is used transiently only for Anthropic's 400 credit rejection.
 const credit=status===400&&type==='invalid_request_error'&&typeof error.message==='string'&&/credit balance|insufficient.{0,15}credit/i.test(error.message);
 const category:AiFailureCategory=credit?'credits':status===401||status===403?'authentication':status===429?'rate_limit':[400,404,422].includes(status)?'unsupported_request':'unknown';
 const expectedType=status===401?'authentication_error':status===403?'permission_error':status===429?'rate_limit_error':status===404?'not_found_error':'invalid_request_error';
 const definite=[400,401,403,404,422,429].includes(status)&&payload.type==='error'&&type===expectedType&&payload.usage===undefined&&payload.content===undefined;
 const receipt:AiRejection|undefined=definite?{httpStatus:status as AiRejection['httpStatus'],category:credit?'credits':category==='authentication'?'authentication_or_policy':category==='rate_limit'?'rate_limit':status===404?'model_unavailable':'invalid_request',code:'other',parameter:'other'}:undefined;
 return new AiCompletionError(category,definite?'rejected':'unknown',receipt);
}
/** A single paid request. The caller owns reservation, settlement and retries. */
export async function completeAnthropicJson(input:AiCompletionRequest,options:AiCompletionOptions={}):Promise<AiCompletionResult>{
 const apiKey=options.apiKey??process.env.ANTHROPIC_API_KEY,model=options.model;
 if(!apiKey)throw new AiCompletionError('authentication','rejected');
 if(!model||!Number.isSafeInteger(input.max_tokens)||input.max_tokens<=0||input.timeoutMs!==undefined&&(!Number.isSafeInteger(input.timeoutMs)||input.timeoutMs<=0))throw new AiCompletionError('unsupported_request','rejected');
 if(input.signal?.aborted)throw new AiCompletionError('cancelled','rejected');
 const messages=input.messages.filter(message=>message.role!=='system');
 if(!messages.length||messages.some(message=>!['user','assistant'].includes(message.role))||messages.at(-1)?.role!=='user')throw new AiCompletionError('unsupported_request','rejected');
 let validator:ReturnType<typeof z.fromJSONSchema>;
 try{validator=z.fromJSONSchema(input.json_schema);}catch{throw new AiCompletionError('unsupported_request','rejected');}
 const schema=wireSchema(input.json_schema);
 const timeout=AbortSignal.timeout(Math.min(input.timeoutMs??30000,40000));
 const signal=input.signal?AbortSignal.any([input.signal,timeout]):timeout;
 return traceOperation('acquire.model.completion',{kind:'generation',provider:'anthropic',model,...(options.jobId?{jobId:options.jobId}:{}),messageCount:input.messages.length,inputBytes:new TextEncoder().encode(JSON.stringify(input.messages)).length},async()=>{
  const started=Date.now();
  try{
   let response:Response;
   try{response=await(options.fetch??globalThis.fetch)('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':apiKey,'anthropic-version':'2023-06-01','Content-Type':'application/json'},body:JSON.stringify({model,max_tokens:input.max_tokens,system:input.messages.filter(message=>message.role==='system').map(message=>message.content).join('\n\n'),messages,service_tier:'standard_only',inference_geo:'global',output_config:{effort:'low',format:{type:'json_schema',schema}}}),signal});}
   catch{throw new AiCompletionError(input.signal?.aborted?'cancelled':timeout.aborted?'timeout':'transport');}
   let payload:Json;
   try{payload=object(await response.json());}catch{throw new AiCompletionError(input.signal?.aborted?'cancelled':timeout.aborted?'timeout':'invalid_json');}
   if(!response.ok||payload.error)throw rejection(response.status,payload);
   if(typeof payload.model!=='string'||payload.model!==model)throw new AiCompletionError('usage_invalid','response');
   const usage=normalizeUsage(payload.usage);
   updateOperationTrace({provider:'anthropic',model,...usage,latencyMs:Date.now()-started});options.onUsage?.(usage,model);
   if(signal.aborted)throw new AiCompletionError(input.signal?.aborted?'cancelled':'timeout','response');
   const content=Array.isArray(payload.content)?payload.content.map(object):[],text=content.filter(block=>block.type==='text');
   if(payload.stop_reason!=='end_turn'||text.length!==1||typeof text[0].text!=='string'||content.some(block=>!['text','thinking','redacted_thinking'].includes(String(block.type))))throw new AiCompletionError('incomplete_response','response');
   let parsed:unknown;try{parsed=JSON.parse(text[0].text);}catch{throw new AiCompletionError('invalid_json','response');}
   if(!validator.safeParse(parsed).success)throw new AiCompletionError('schema_validation','response');
   return {response:parsed,model,usage};
  }catch(error){updateOperationTrace({provider:'anthropic',failureCategory:error instanceof AiCompletionError?error.category:'unknown',latencyMs:Date.now()-started});throw error;}
 });
}
