import {expect,it,vi} from 'vitest';
import {OpenAiResearch} from './openai';
const request={operation:'business_extraction' as const,messages:[{role:'user',content:'Synthetic source'}],max_tokens:1200,response_format:{type:'json_schema',json_schema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}};
const ok=(model='gpt-6-luna',content='{"value":"supported"}')=>Response.json({model,choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:1000,completion_tokens:100,prompt_tokens_details:{cached_tokens:0},completion_tokens_details:{reasoning_tokens:0}}});
it('uses Luna without reasoning and falls back within the shared deadline',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({error:{code:'rate_limit_exceeded'}},{status:429})).mockResolvedValueOnce(ok('gpt-5.6-luna'));
 const onRequest=vi.fn(),onUsage=vi.fn();
 expect((await new OpenAiResearch({apiKey:'test',fetch:fetcher,onRequest,onUsage}).complete(request)).response).toEqual({value:'supported'});
 expect(fetcher.mock.calls.map(([,init])=>JSON.parse(init.body).model)).toEqual(['gpt-6-luna','gpt-5.6-luna']);
 expect(onRequest).toHaveBeenCalledTimes(2);
 expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({model:'gpt-5.6-luna',inputTokens:1000,outputTokens:100,reasoningTokens:0,cost:0.00032}));
});
it.each([[401,'invalid_api_key'],[403,'permission_denied'],[429,'insufficient_quota'],[400,'invalid_request_error']])('stops on credential, quota and malformed requests %s',async(status,code)=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({error:{code,message:'raw-secret-provider-body'}},{status}));
 await expect(new OpenAiResearch({apiKey:'test',fetch:fetcher}).complete(request)).rejects.toThrow(`HTTP ${status}`);
 expect(fetcher).toHaveBeenCalledOnce();
});
it('rejects unsupported schemas and never accepts invalid JSON as evidence',async()=>{
 const fetcher=vi.fn().mockImplementation(()=>Promise.resolve(ok('gpt-6-luna','{"value":18}')));
 await expect(new OpenAiResearch({apiKey:'test',fetch:fetcher}).complete(request)).rejects.toThrow(/schema/);
 expect(fetcher).toHaveBeenCalledTimes(2);
});
it('does not start another request when the deadline is exhausted',async()=>{
 let now=0;const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
 try{const fetcher=vi.fn().mockImplementation(async()=>{now=45001;throw new DOMException('aborted','TimeoutError')});
 await expect(new OpenAiResearch({apiKey:'test',fetch:fetcher}).complete(request)).rejects.toThrow();expect(fetcher).toHaveBeenCalledOnce();
 }finally{clock.mockRestore()}
});
