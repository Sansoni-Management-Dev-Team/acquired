import {afterEach,expect,it,vi} from 'vitest';
import {completeAiJson} from './provider';
const input={operation:'test',messages:[{role:'user',content:'Synthetic'}],json_schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},max_tokens:20,requireUsage:true};
afterEach(()=>vi.unstubAllEnvs());
it('keeps the OpenAI wire contract and validates the application schema with one request',async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({model:'gpt-6-luna',usage:{prompt_tokens:10,completion_tokens:2},choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]})));
 expect(await completeAiJson(input,{provider:'openai',model:'gpt-6-luna',apiKey:'synthetic',fetch:fetcher})).toMatchObject({response:{ok:true},usage:{inputTokens:10,outputTokens:2}});
 expect(fetcher).toHaveBeenCalledTimes(1);expect(JSON.parse(fetcher.mock.calls[0][1].body).response_format.type).toBe('json_schema');
});
it.each([[401,'authentication'],[429,'credits'],[429,'rate_limit']])('classifies rejection %s %s without fallback',async(status,category)=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{type:category==='credits'?'insufficient_quota':category==='authentication'?'authentication_error':'rate_limit_error',code:category==='credits'?'credit_balance_exhausted':'other'}}),{status}));
 await expect(completeAiJson(input,{provider:'openai',model:'gpt-6-luna',apiKey:'synthetic',fetch:fetcher})).rejects.toMatchObject({category,outcome:'rejected'});expect(fetcher).toHaveBeenCalledTimes(1);
});
it('cancels before network access and rejects unknown provider selection',async()=>{const f=vi.fn();await expect(completeAiJson({...input,signal:AbortSignal.abort()},{provider:'openai',model:'gpt-6-luna',apiKey:'synthetic',fetch:f})).rejects.toMatchObject({category:'cancelled'});expect(f).not.toHaveBeenCalled();});
const response=(patch:Record<string,unknown>={})=>({model:'gpt-6-luna',usage:{prompt_tokens:10,completion_tokens:2},choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}],...patch});
const options=(fetcher:typeof fetch)=>({provider:'openai' as const,model:'gpt-6-luna',apiKey:'synthetic',fetch:fetcher});
it('requires usage by default and never fabricates absent output token counts',async()=>{
 for(const usage of [undefined,{prompt_tokens:10},{prompt_tokens:10,completion_tokens:null},{prompt_tokens:10,completion_tokens:2,prompt_tokens_details:{cached_tokens:null}}]){
 const f=vi.fn().mockResolvedValue(Response.json(response({usage})));await expect(completeAiJson({...input,requireUsage:undefined},options(f))).rejects.toMatchObject({category:'usage_invalid'});expect(f).toHaveBeenCalledTimes(1);}
});
it('refuses wrong or absent model identities and incomplete finish reasons with no additional paid request',async()=>{
 for(const patch of [{model:'different-model'},{model:undefined},{choices:[{finish_reason:'content_filter',message:{content:'{"ok":true}'}}]},{choices:[{message:{content:'{"ok":true}'}}]}]){const f=vi.fn().mockResolvedValue(Response.json(response(patch)));await expect(completeAiJson(input,options(f))).rejects.toBeInstanceOf(Error);expect(f).toHaveBeenCalledTimes(1);}
});
it('does not repair schema violations and preserves the known usage receipt',async()=>{
 const f=vi.fn().mockResolvedValue(Response.json(response({choices:[{finish_reason:'stop',message:{content:'{"ok":"true"}'}}]}))),onUsage=vi.fn();await expect(completeAiJson(input,{...options(f),onUsage})).rejects.toMatchObject({category:'schema_validation',outcome:'response'});expect(onUsage).toHaveBeenCalledTimes(1);expect(f).toHaveBeenCalledTimes(1);
});
it('makes unknown and malformed failures safe without leaking underlying text',async()=>{
 for(const value of [new TypeError('secret transport body'),new Error('private failure')]){const f=vi.fn().mockRejectedValue(value);await expect(completeAiJson({...input,requireUsage:undefined},options(f))).rejects.toMatchObject({name:'AiCompletionError',category:'transport'});expect(f).toHaveBeenCalledTimes(1);}
 const f=vi.fn().mockResolvedValue(new Response('private invalid JSON'));await expect(completeAiJson(input,options(f))).rejects.toMatchObject({category:'invalid_json'});
});
it('requires explicit model and valid bounded timeout before any request',async()=>{
 const f=vi.fn();for(const timeoutMs of [0,-1,NaN,Infinity])await expect(completeAiJson({...input,timeoutMs},options(f))).rejects.toMatchObject({category:'unsupported_request'});await expect(completeAiJson(input,{...options(f),model:undefined})).rejects.toMatchObject({category:'unsupported_request'});expect(f).not.toHaveBeenCalled();
});
it('caps a caller supplied timeout and cancels after a completed response without authorizing its result',async()=>{
 const timeout=vi.spyOn(AbortSignal,'timeout');const controller=new AbortController(),onUsage=vi.fn(),f=vi.fn(async()=>{controller.abort();return Response.json(response());});await expect(completeAiJson({...input,timeoutMs:999999,signal:controller.signal},{...options(f),onUsage})).rejects.toMatchObject({category:'cancelled',outcome:'response'});expect(onUsage).toHaveBeenCalledTimes(1);expect(timeout.mock.calls.every(([ms])=>ms<=40000)).toBe(true);timeout.mockRestore();
});
it('keeps ambiguous rate-limit receipts uncertain',async()=>{
 for(const error of [{},{type:'unrecognized',message:'private'}]){const f=vi.fn().mockResolvedValue(Response.json({error},{status:429}));await expect(completeAiJson(input,options(f))).rejects.toMatchObject({category:'rate_limit',outcome:'unknown'});}
});
it('separates timeout from caller cancellation after submission and never retries either',async()=>{
 for(const cancel of [true,false]){const controller=new AbortController();const f=vi.fn((_url:unknown,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true})));const pending=completeAiJson({...input,timeoutMs:5,signal:controller.signal},options(f));if(cancel)controller.abort();await expect(pending).rejects.toMatchObject({category:cancel?'cancelled':'timeout',outcome:'unknown'});expect(f).toHaveBeenCalledTimes(1);}
});
it('rejects unsupported provider selection without network access',async()=>{
 const f=vi.fn();await expect(completeAiJson(input,{...options(f),provider:'unapproved' as 'openai'})).rejects.toMatchObject({category:'unsupported_request'});expect(f).not.toHaveBeenCalled();
});
