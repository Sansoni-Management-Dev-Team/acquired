import { expect,it,vi } from 'vitest';
import {completeOpenAiJson} from './openai';
const input={operation:'business_extraction',messages:[{role:'user',content:'Synthetic source only'}],json_schema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},max_tokens:1200};
it('disables Luna reasoning and reports billed output including cached/reasoning usage',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({model:'gpt-6-luna',choices:[{finish_reason:'stop',message:{content:'{"value":"supported"}'}}],usage:{prompt_tokens:1000,prompt_tokens_details:{cached_tokens:200},completion_tokens:150,completion_tokens_details:{reasoning_tokens:0}}}));
 const result=await completeOpenAiJson(input,{apiKey:'synthetic-key',model:'gpt-6-luna',fetch:fetcher});
 expect(JSON.parse(fetcher.mock.calls[0][1].body).reasoning_effort).toBe('none');
 expect(result).toMatchObject({response:{value:'supported'},model:'gpt-6-luna',usage:{inputTokens:1000,cachedInputTokens:200,outputTokens:150,reasoningTokens:0}});
});
it('refuses missing or inconsistent usage when native execution requires an accounting receipt',async()=>{
 for(const usage of [undefined,{prompt_tokens:0,completion_tokens:20},{prompt_tokens:100,completion_tokens:-1},{prompt_tokens:100,completion_tokens:20,completion_tokens_details:{reasoning_tokens:30}}]){
  const fetcher=vi.fn().mockResolvedValue(Response.json({model:'gpt-6-luna',choices:[{finish_reason:'stop',message:{content:'{"value":"supported"}'}}],usage}));
  await expect(completeOpenAiJson({...input,requireUsage:true},{apiKey:'synthetic-key',model:'gpt-6-luna',fetch:fetcher})).rejects.toThrow(/usage/);
 }
});
it('preserves only safe definite rejection metadata without retaining provider messages',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({error:{message:'private prompt echo',type:'invalid_request_error',code:'invalid_json_schema',param:'response_format'}},{status:400}));
 await expect(completeOpenAiJson(input,{apiKey:'synthetic-key',model:'gpt-6-luna',fetch:fetcher})).rejects.toMatchObject({name:'OpenAiProviderRejection',rejection:{httpStatus:400,category:'invalid_request',code:'invalid_json_schema',parameter:'response_format'}});
});
it('does not claim definite no-execution for ambiguous or success-shaped responses',async()=>{
 for(const [status,payload] of [[500,{error:{type:'invalid_request_error'}}],[400,{error:{message:'unknown body'}}],[400,{error:{type:'invalid_request_error'},usage:{prompt_tokens:100}}]] as const){
  const fetcher=vi.fn().mockResolvedValue(Response.json(payload,{status}));try{await completeOpenAiJson(input,{apiKey:'synthetic-key',fetch:fetcher});throw Error('Expected rejection');}catch(error){expect((error as Error).name).not.toBe('OpenAiProviderRejection');}
 }
});
it('preserves the original research fallback policy for a typed model-not-found response',async()=>{
 const {OpenAiResearch}=await import('./openai');const fetcher=vi.fn().mockResolvedValueOnce(Response.json({error:{type:'invalid_request_error',code:'model_not_found',param:'model'}},{status:404})).mockResolvedValueOnce(Response.json({model:'gpt-5.6-luna',choices:[{finish_reason:'stop',message:{content:'{"value":"supported"}'}}],usage:{prompt_tokens:100,completion_tokens:20}}));
 const research=new OpenAiResearch({apiKey:'synthetic-key',model:'gpt-6-luna',fallbackModel:'gpt-5.6-luna',fetch:fetcher});expect(await research.complete({messages:input.messages,max_tokens:1200,response_format:{type:'json_schema',json_schema:input.json_schema}})).toEqual({response:{value:'supported'}});expect(fetcher).toHaveBeenCalledTimes(2);
});
it('allows a reviewed minimal-reasoning comparison and preserves reported cache-write token details',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({model:'gpt-5-nano',choices:[{finish_reason:'stop',message:{content:'{"value":"supported"}'}}],usage:{prompt_tokens:1000,prompt_tokens_details:{cached_tokens:200,cache_write_tokens:300},completion_tokens:150,completion_tokens_details:{reasoning_tokens:70}}}));
 const result=await completeOpenAiJson({...input,requireUsage:true,reasoning_effort:'minimal'},{apiKey:'synthetic-key',model:'gpt-5-nano',fetch:fetcher});expect(JSON.parse(fetcher.mock.calls[0][1].body).reasoning_effort).toBe('minimal');expect(result.usage).toMatchObject({cachedInputTokens:200,cacheWriteTokens:300,reasoningTokens:70});
});
it('distinguishes incomplete and invalid JSON responses using fixed safe categories while preserving single-attempt usage',async()=>{for(const[finish,content,category]of[['length','private partial','incomplete_response'],['stop','private invalid JSON','invalid_json']]as const){const usage=vi.fn(),fetcher=vi.fn().mockResolvedValue(Response.json({model:'gpt-6-luna',choices:[{finish_reason:finish,message:{content}}],usage:{prompt_tokens:100,completion_tokens:30}}));await expect(completeOpenAiJson(input,{apiKey:'synthetic',fetch:fetcher,onUsage:usage})).rejects.toMatchObject({name:'OpenAiResponseFailure',category});expect(fetcher).toHaveBeenCalledTimes(1);expect(usage).toHaveBeenCalledOnce();}});
