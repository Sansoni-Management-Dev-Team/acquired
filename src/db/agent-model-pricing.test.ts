import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {AgentModelStore} from './agent-model-store';
import type {AgentThread} from './agent-store';
const id='10000000-0000-4000-8000-000000000001',actor={organizationId:'pricing-org',userId:'pricing-owner'},thread:AgentThread={id,organization_id:actor.organizationId,owner_user_id:actor.userId,mandate_id:id,revision:1};
const legacy={model:'gpt-6-luna',maxInputTokens:64000,maxOutputTokens:2000,inputPriceMicroUsdPerMillion:'125000',outputPriceMicroUsdPerMillion:'500000',promptVersion:'native-chat-v2-cache-write-ceiling',requestDigest:'a'.repeat(64)};
const usage={inputTokens:1000,outputTokens:100,cachedInputTokens:200,reasoningTokens:0};
function fixture(input:unknown=legacy){
 const query=vi.fn(async(sql:string,values?:unknown[])=>{void values;return {rows:sql.startsWith('SELECT * FROM agent_operations')?[{id,state:'running',input}]:sql.startsWith('SELECT r.account_id')?Array.from({length:6},(_,i)=>({account_id:String(i),unit:i%2?'usd_micro':'calls'})):[],rowCount:1};});
 const client={query} as unknown as PoolClient;
 class Harness extends AgentModelStore{protected override async nativeTransaction<T>(work:(c:PoolClient)=>Promise<T>){return work(client);}protected override async lockThread(){return thread;}protected override async emit(){}}
 return {query,store:new Harness({} as Pick<Pool,'connect'>,actor)};
}
it('characterizes historical cached OpenAI usage settlement with its recorded ceiling',async()=>{
 const f=fixture(),result=await f.store.finishChatModel(id,id,'1',{model:'gpt-6-luna-2026',usage,response:{text:'ok'}});
 expect(result).toMatchObject({estimatedCostMicroUsd:'175',costBasis:'configured_price_ceiling_no_cached_discount',usageDetails:'reported'});
 expect(f.query.mock.calls.some(([sql])=>sql.includes('agent_settle_budget'))).toBe(true);
});
it('characterizes unknown model and usage as uncertain without releasing reserved money',async()=>{
 for(const value of [{model:'other',usage},{model:'gpt-6-luna',usage:null}]){
  const result=await fixture().store.finishChatModel(id,id,'1',{...value,reason:'provider_outcome_unknown'});
  expect(result.estimatedCostMicroUsd).toBeNull();
 }
});
const anthropic={...legacy,model:'claude-haiku-5-5',provider:'anthropic',pricingVersion:'anthropic-haiku-5-5-global-2026-10-24',inputPriceMicroUsdPerMillion:'200000',rates:{input:'100000',cachedInput:'10000',cacheWrite5m:'125000',cacheWrite1h:'200000',output:'500000',longContextThreshold:100000,longContextMultiplier:5}};
it('settles Anthropic cache categories from the immutable operation price snapshot',async()=>{
 const result=await fixture(anthropic).store.finishChatModel(id,id,'1',{model:anthropic.model,usage:{...usage,cacheWriteTokens:300,cacheWrite5mTokens:200,cacheWrite1hTokens:100},response:{text:'ok'}});
 expect(result).toMatchObject({estimatedCostMicroUsd:'147',costBasis:'recorded_provider_rates'});
});
it('records rejected quota requests at zero monetary cost without weakening unknown outcomes',async()=>{
 const f=fixture(anthropic),result=await f.store.finishChatModel(id,id,'1',{model:anthropic.model,usage:null,reason:'provider_request_rejected',rejection:{httpStatus:429,category:'credits',code:'other',parameter:'other'}});
 expect(result).toMatchObject({estimatedCostMicroUsd:'0',usageDetails:'not_executed'});
 const call=f.query.mock.calls.find(([sql])=>sql.startsWith('UPDATE agent_operations'));
 expect(call).toBeDefined();
});
it('does not settle an Anthropic alias or a receipt with missing cache duration information',async()=>{
 for(const value of [{model:anthropic.model+'-other',usage},{model:anthropic.model,usage:{...usage,cacheWriteTokens:10}}]){
 const result=await fixture(anthropic).store.finishChatModel(id,id,'1',{...value,reason:'provider_outcome_unknown'});expect(result.estimatedCostMicroUsd).toBeNull();
 }
});
function replayFixture(input:Record<string,unknown>,state='complete'){
 const response={action:'review',reason:'Human review required',sourceIds:[]},query=vi.fn(async(sql:string)=>({rows:sql.startsWith('SELECT * FROM agent_operations')?[{id,state,input,input_digest:'old-configuration-digest',result:{response}}]:sql.startsWith('SELECT id FROM agent_operations')?[{id}]:[],rowCount:1}));
 const client={query} as unknown as PoolClient;
 class Harness extends AgentModelStore{protected override async nativeTransaction<T>(work:(c:PoolClient)=>Promise<T>){return work(client);}protected override async lockThread(){return thread;}protected override async assertExecutionFence(){}}
 return {query,response,store:new Harness({} as Pick<Pool,'connect'>,actor)};
}
it('replays completed chat across provider configuration changes without a new reservation',async()=>{
 const f=replayFixture(legacy);expect(await f.store.beginChatModel(id,id,anthropic)).toEqual({kind:'cached',operationId:id,response:f.response});
 expect(f.query.mock.calls.some(([sql])=>sql.includes('agent_reserve_budget')||sql.startsWith('INSERT'))).toBe(false);
 for(const change of [{requestDigest:'b'.repeat(64)},{promptVersion:'new-prompt'}])await expect(replayFixture(legacy).store.beginChatModel(id,id,{...anthropic,...change})).rejects.toThrow('changed');
 for(const state of ['running','uncertain'])await expect(replayFixture(legacy,state).store.beginChatModel(id,id,anthropic)).rejects.toThrow();
});
it('replays completed decisions across pricing changes only with the same context and prompt',async()=>{
 const {requestDigest:_unused,...oldSpec}=legacy;void _unused;
 const {requestDigest:_newUnused,...newSpec}=anthropic;void _newUnused;
 const input={...oldSpec,conversationId:id,contextRevision:'b'.repeat(64)},next={...newSpec,conversationId:id,contextRevision:'b'.repeat(64)},f=replayFixture(input);
 expect(await f.store.beginNativeModel(id,'saved-key',next)).toEqual({kind:'cached',operationId:id,response:f.response});
 for(const change of [{contextRevision:'c'.repeat(64)},{promptVersion:'new-prompt'}])await expect(replayFixture(input).store.beginNativeModel(id,'saved-key',{...next,...change})).rejects.toThrow('changed');
 for(const state of ['running','uncertain'])await expect(replayFixture(input,state).store.beginNativeModel(id,'saved-key',next)).rejects.toThrow();
 expect(f.query.mock.calls.some(([sql])=>sql.includes('agent_reserve_budget')||sql.startsWith('INSERT'))).toBe(false);
});

it('retains reservation uncertainty for incomplete legacy token detail without inventing reasoning usage',async()=>{
 const f=fixture(),result=await f.store.finishChatModel(id,id,'1',{model:legacy.model,usage:{inputTokens:1000,outputTokens:100,cachedInputTokens:200},reason:'provider_outcome_unknown'});
 expect(result.estimatedCostMicroUsd).toBeNull();
 const values=f.query.mock.calls.find(([sql])=>sql.includes('agent_settle_budget'))?.[1];
 expect(JSON.parse(values?.[1] as string)).toEqual(Array.from({length:6},(_,i)=>({accountId:String(i),actual:i%2?null:'1'})));
 expect(f.query.mock.calls.find(([sql])=>sql.startsWith('UPDATE agent_operations'))?.[1]?.[1]).toBe('uncertain');
});
