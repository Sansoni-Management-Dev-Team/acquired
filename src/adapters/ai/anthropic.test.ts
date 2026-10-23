import {expect,it,vi} from 'vitest';
import {completeAnthropicJson} from './anthropic';
const schema={type:'object',properties:{routeId:{type:'string',enum:['saved-route']},subject:{type:'string',maxLength:0},body:{type:'string',minLength:1,maxLength:300}},required:['routeId','subject','body'],additionalProperties:false};
const input={operation:'agent_conversation_decision',messages:[{role:'system',content:'Synthetic instruction'},{role:'user',content:'Synthetic context'}],json_schema:schema,max_tokens:2000,requireUsage:true};
const valid={routeId:'saved-route',subject:'',body:'Hello'};
const payload=(patch:Record<string,unknown>={})=>({id:'msg_synthetic',type:'message',role:'assistant',model:'claude-haiku-5-5',stop_reason:'end_turn',content:[{type:'thinking',thinking:'',signature:'opaque'},{type:'text',text:JSON.stringify(valid)}],usage:{input_tokens:100,output_tokens:20,cache_creation_input_tokens:0,cache_read_input_tokens:0},...patch});
const run=(body:Record<string,unknown>=payload(),status=200,onUsage=vi.fn())=>{const fetcher=vi.fn().mockResolvedValue(Response.json(body,{status}));return {fetcher,onUsage,promise:completeAnthropicJson(input,{apiKey:'synthetic-key',model:'claude-haiku-5-5',fetch:fetcher,onUsage})};};
it('makes one direct Messages request with system separated and supported structured-output fields',async()=>{
 const {promise,fetcher}=run();expect(await promise).toMatchObject({response:valid,model:'claude-haiku-5-5',usage:{inputTokens:100,outputTokens:20,cachedInputTokens:0,cacheWriteTokens:0}});
 const [url,init]=fetcher.mock.calls[0];expect(url).toBe('https://api.anthropic.com/v1/messages');expect(init.headers).toMatchObject({'x-api-key':'synthetic-key','anthropic-version':'2023-06-01'});
 const body=JSON.parse(init.body);expect(body).toMatchObject({model:'claude-haiku-5-5',system:'Synthetic instruction',messages:[{role:'user',content:'Synthetic context'}],max_tokens:2000,service_tier:'standard_only',inference_geo:'global',output_config:{effort:'low',format:{type:'json_schema'}}});
 expect(body.temperature).toBeUndefined();expect(body.reasoning_effort).toBeUndefined();expect(body.cache_control).toBeUndefined();expect(body.output_config.format.schema.properties.body.maxLength).toBeUndefined();expect(body.output_config.format.schema.properties.body.description).toContain('300');expect(fetcher).toHaveBeenCalledTimes(1);
});
it('preserves exact routes, empty social subjects and length constraints in local validation without repairing drafts',async()=>{
 for(const value of [{...valid,routeId:'other'},{...valid,subject:'not empty'},{...valid,body:'x'.repeat(301)},{...valid,body:''}]){
  const {promise,onUsage,fetcher}=run(payload({content:[{type:'text',text:JSON.stringify(value)}]}));await expect(promise).rejects.toMatchObject({category:'schema_validation'});expect(onUsage).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledTimes(1);
 }
});
it('normalizes disjoint input categories and keeps both cache write durations',async()=>{
 const {promise}=run(payload({usage:{input_tokens:100,output_tokens:20,cache_read_input_tokens:40,cache_creation_input_tokens:30,cache_creation:{ephemeral_5m_input_tokens:20,ephemeral_1h_input_tokens:10}}}));expect((await promise).usage).toMatchObject({inputTokens:170,outputTokens:20,cachedInputTokens:40,cacheWriteTokens:30,cacheWrite5mTokens:20,cacheWrite1hTokens:10});
});
it('does not fabricate missing usage or accept inconsistent cache accounting',async()=>{
 for(const usage of [undefined,{input_tokens:100},{input_tokens:-1,output_tokens:20},{input_tokens:100,output_tokens:20,cache_creation_input_tokens:30},{input_tokens:100,output_tokens:20,cache_creation_input_tokens:30,cache_creation:{ephemeral_5m_input_tokens:10,ephemeral_1h_input_tokens:10}},{input_tokens:100,output_tokens:20,server_tool_use:{web_search_requests:1}}]){
  const {promise,onUsage}=run(payload({usage}));await expect(promise).rejects.toMatchObject({category:'usage_invalid'});expect(onUsage).not.toHaveBeenCalled();
 }
});
it('records known usage before rejecting invalid JSON, truncation and refusals',async()=>{
 for(const [patch,category] of [[{content:[{type:'text',text:'not json'}]},'invalid_json'],[{stop_reason:'max_tokens'},'incomplete_response'],[{stop_reason:'refusal'},'incomplete_response'],[{content:[]},'incomplete_response']] as const){const {promise,onUsage}=run(payload(patch));await expect(promise).rejects.toMatchObject({category});expect(onUsage).toHaveBeenCalledTimes(1);}
});
it('classifies positive rejections without exposing arbitrary provider errors or retrying',async()=>{
 for(const [status,type,message,category] of [[401,'authentication_error','private','authentication'],[400,'invalid_request_error','Your credit balance is too low','credits'],[429,'rate_limit_error','private','rate_limit'],[400,'invalid_request_error','private schema','unsupported_request']] as const){const {promise,fetcher}=run({type:'error',error:{type,message}},status);await expect(promise).rejects.toMatchObject({category,outcome:'rejected'});try{await promise;}catch(error){expect(JSON.stringify(error)).not.toContain(message);}expect(fetcher).toHaveBeenCalledTimes(1);}
});
it('keeps server errors and contradictory rejection receipts uncertain',async()=>{
 for(const [status,body] of [[500,{type:'error',error:{type:'api_error'}}],[401,{type:'error',error:{type:'authentication_error'},usage:{input_tokens:2}}],[429,{}]] as const){await expect(run(body,status).promise).rejects.toMatchObject({outcome:'unknown'});}
});
it('does not send pre-cancelled requests and never retries transport failures',async()=>{
 const fetcher=vi.fn().mockRejectedValue(new TypeError('private transport text'));
 await expect(completeAnthropicJson({...input,signal:AbortSignal.abort()},{apiKey:'synthetic-key',model:'claude-haiku-5-5',fetch:fetcher})).rejects.toMatchObject({category:'cancelled'});expect(fetcher).not.toHaveBeenCalled();
 await expect(completeAnthropicJson(input,{apiKey:'synthetic-key',model:'claude-haiku-5-5',fetch:fetcher})).rejects.toMatchObject({category:'transport',outcome:'unknown'});expect(fetcher).toHaveBeenCalledTimes(1);
});
it('propagates caller cancellation and bounded timeout as uncertain after submission',async()=>{
 for(const cancel of [true,false]){const controller=new AbortController();const fetcher=vi.fn((_url:unknown,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true});}));const pending=completeAnthropicJson({...input,signal:controller.signal,timeoutMs:10},{apiKey:'synthetic-key',model:'claude-haiku-5-5',fetch:fetcher});if(cancel)controller.abort();await expect(pending).rejects.toMatchObject({category:cancel?'cancelled':'timeout',outcome:'unknown'});expect(fetcher).toHaveBeenCalledTimes(1);}
});
it('rejects explicitly null cache counters rather than fabricating zero',async()=>{
 for(const field of ['cache_creation_input_tokens','cache_read_input_tokens']){await expect(run(payload({usage:{input_tokens:100,output_tokens:20,[field]:null}})).promise).rejects.toMatchObject({category:'usage_invalid'});}
});
it('records late usage but does not accept a decision after cancellation',async()=>{
 const controller=new AbortController(),onUsage=vi.fn();const fetcher=vi.fn(async()=>{controller.abort();return Response.json(payload());});await expect(completeAnthropicJson({...input,signal:controller.signal},{apiKey:'synthetic-key',model:'claude-haiku-5-5',fetch:fetcher,onUsage})).rejects.toMatchObject({category:'cancelled',outcome:'response'});expect(onUsage).toHaveBeenCalledTimes(1);
});
it('preserves application property names that resemble schema keywords',async()=>{
 const custom={type:'object',properties:{maxLength:{type:'string',const:'saved'}},required:['maxLength'],additionalProperties:false};const fetcher=vi.fn().mockResolvedValue(Response.json(payload({content:[{type:'text',text:'{"maxLength":"saved"}'}]})));expect((await completeAnthropicJson({...input,json_schema:custom},{apiKey:'synthetic-key',model:'claude-haiku-5-5',fetch:fetcher})).response).toEqual({maxLength:'saved'});expect(JSON.parse(fetcher.mock.calls[0][1].body).output_config.format.schema.properties.maxLength).toEqual({type:'string',const:'saved'});
});
