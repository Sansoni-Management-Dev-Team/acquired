import { expect,it,vi } from 'vitest';
import {completeOpenAiJson} from './openai';
const input={operation:'business_extraction',messages:[{role:'user',content:'Synthetic source only'}],json_schema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},max_tokens:1200};
it('disables Luna reasoning and reports billed output including cached/reasoning usage',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({model:'gpt-6-luna',choices:[{finish_reason:'stop',message:{content:'{"value":"supported"}'}}],usage:{prompt_tokens:1000,prompt_tokens_details:{cached_tokens:200},completion_tokens:150,completion_tokens_details:{reasoning_tokens:0}}}));
 const result=await completeOpenAiJson(input,{apiKey:'synthetic-key',model:'gpt-6-luna',fetch:fetcher});
 expect(JSON.parse(fetcher.mock.calls[0][1].body).reasoning_effort).toBe('none');
 expect(result).toMatchObject({response:{value:'supported'},model:'gpt-6-luna',usage:{inputTokens:1000,cachedInputTokens:200,outputTokens:150,reasoningTokens:0}});
});
