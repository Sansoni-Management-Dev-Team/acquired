import {afterEach,expect,it,vi} from 'vitest';
import {createResearchAi} from './research-provider';
import {OpenAiResearch} from './openai';
import {FreeOpenRouter} from './free-openrouter';
import {createAiProvider} from './provider';
afterEach(()=>vi.unstubAllEnvs());
it('selects direct OpenAI only from server configuration and does not silently change provider',()=>{
 expect(createResearchAi({RESEARCH_AI_PROVIDER:'openai',OPENAI_API_KEY:'test'})).toBeInstanceOf(OpenAiResearch);
 expect(createResearchAi({OPENROUTER_API_KEY:'test'})).toBeInstanceOf(FreeOpenRouter);
 expect(()=>createResearchAi({RESEARCH_AI_PROVIDER:'unsupported'})).toThrow('Unsupported');
});
it('offers the same direct provider to neutral structured app tasks',async()=>{
 vi.stubEnv('AI_PROVIDER','openai');vi.stubEnv('OPENAI_API_KEY','test');
 expect(createAiProvider().name).toBe('openai');
 expect(createAiProvider().model).toBe('gpt-6-luna');
 expect(createAiProvider().isConfigured()).toBe(true);
});
