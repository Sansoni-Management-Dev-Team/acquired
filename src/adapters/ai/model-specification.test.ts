import {expect,it} from 'vitest';
import {anthropicModelSpecification as spec,configuredAgentModelSpecification,modelUsageCostMicroUsd,nativeModelSpecification} from './model-specification';
import {modelBudgetUpperBound} from '@/domain/agent-budget';
it('selects only an explicitly reviewed provider/model pair while preserving the legacy default',()=>{
 expect(configuredAgentModelSpecification({})).toEqual(nativeModelSpecification);
 expect(configuredAgentModelSpecification({AGENT_AI_PROVIDER:'anthropic',AGENT_DECISION_MODEL:'claude-haiku-5-5'})).toEqual(spec);
 for(const env of [{AGENT_AI_PROVIDER:'anthropic'},{AGENT_DECISION_MODEL:'claude-haiku-5-5'},{AGENT_AI_PROVIDER:'other'}])expect(()=>configuredAgentModelSpecification(env)).toThrow('reviewed');
});
it('reserves the reviewed maximum cache write ceiling and rounds aggregate cost upward once',()=>{
 expect(modelBudgetUpperBound({...spec,maxAttempts:1})).toBe('13800');
 expect(modelUsageCostMicroUsd(spec,{inputTokens:1,outputTokens:1,cachedInputTokens:0},spec.model)).toBe('1');
 expect(modelUsageCostMicroUsd(spec,{inputTokens:10,outputTokens:0,cachedInputTokens:0},spec.model)).toBe('1');
 expect(modelUsageCostMicroUsd(spec,{inputTokens:1000,outputTokens:100,cachedInputTokens:200,cacheWriteTokens:300,cacheWrite5mTokens:200,cacheWrite1hTokens:100},spec.model)).toBe('147');
});
it('prices total context including cache at the documented long-context rate without hiding overrun',()=>{
 expect(modelUsageCostMicroUsd(spec,{inputTokens:100000,outputTokens:100,cachedInputTokens:90000},spec.model)).toBe('1950');
 expect(modelUsageCostMicroUsd(spec,{inputTokens:100001,outputTokens:100,cachedInputTokens:90000},spec.model)).toBe('9751');
});
it('uses saved rates for historical Anthropic operations rather than current constants',()=>{
 expect(modelUsageCostMicroUsd({...spec,rates:{...spec.rates,input:'300000'}},{inputTokens:1000,outputTokens:0,cachedInputTokens:0},spec.model)).toBe('300');
});
it('refuses inconsistent, absent, foreign or unsupported category receipts',()=>{
 for(const usage of [null,{inputTokens:10,outputTokens:0},{inputTokens:10,outputTokens:0,cachedInputTokens:11},{inputTokens:10,outputTokens:0,cachedInputTokens:0,cacheWriteTokens:2},{inputTokens:10,outputTokens:0,cachedInputTokens:0,cacheWriteTokens:2,cacheWrite5mTokens:1,cacheWrite1hTokens:0},{inputTokens:NaN,outputTokens:0,cachedInputTokens:0}])expect(modelUsageCostMicroUsd(spec,usage,spec.model)).toBeNull();
 expect(modelUsageCostMicroUsd(spec,{inputTokens:10,outputTokens:0,cachedInputTokens:0},'claude-haiku-5-5-alias')).toBeNull();
});
