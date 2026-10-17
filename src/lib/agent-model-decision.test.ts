import {expect,it,vi} from 'vitest';
import {createNativeModelDecision} from './agent-model-decision';
import type {AgentConversationContext} from './agent-conversation-engine';
const context={conversationId:'10000000-0000-4000-8000-000000000001',contextRevision:'a'.repeat(64),history:[],sources:[],guidance:[],goal:'Synthetic acquisition goal'} as unknown as AgentConversationContext;
const response={action:'review',reason:'Approved public buyer information is required',sourceIds:[]};
const fixture=()=>({beginNativeModel:vi.fn().mockResolvedValue({kind:'started',operationId:'op',fence:'1'}),finishNativeModel:vi.fn().mockResolvedValue({}),complete:vi.fn().mockImplementation(async(_request,options)=>{options.onUsage({inputTokens:1000,outputTokens:100,cachedInputTokens:400,reasoningTokens:30},'gpt-6-luna');return {response:{decision:response},model:'gpt-6-luna',usage:{inputTokens:1000,outputTokens:100,cachedInputTokens:400,reasoningTokens:30}};})});
it('reserves budget before one bounded request and records observed usage before returning a decision',async()=>{
 const port=fixture(),decide=createNativeModelDecision({store:port,threadId:'thread',requestKey:'event',complete:port.complete});
 expect(await decide(context)).toEqual(response);
 expect(port.beginNativeModel.mock.invocationCallOrder[0]).toBeLessThan(port.complete.mock.invocationCallOrder[0]);
 expect(port.complete).toHaveBeenCalledTimes(1);expect(port.finishNativeModel).toHaveBeenCalledWith('thread','op','1',expect.objectContaining({response,usage:{inputTokens:1000,outputTokens:100,cachedInputTokens:400,reasoningTokens:30}}));
 const request=port.complete.mock.calls[0][0];expect(request).toMatchObject({max_tokens:2000,requireUsage:true});expect(request.messages[0].content).toContain('untrusted');
});
it('does not call the provider when budget admission fails or a completion is already saved',async()=>{
 const port=fixture();port.beginNativeModel.mockRejectedValueOnce(new Error('Budget exhausted'));
 const decide=createNativeModelDecision({store:port,threadId:'thread',requestKey:'event',complete:port.complete});
 await expect(decide(context)).rejects.toThrow('Budget exhausted');expect(port.complete).not.toHaveBeenCalled();
 port.beginNativeModel.mockResolvedValueOnce({kind:'cached',operationId:'op',response});expect(await decide(context)).toEqual(response);expect(port.complete).not.toHaveBeenCalled();
});
it('retains unknown usage and never waterfalls or retries an uncertain provider call',async()=>{
 const port=fixture();port.complete.mockRejectedValue(new Error('Transport unknown'));
 const decide=createNativeModelDecision({store:port,threadId:'thread',requestKey:'event',complete:port.complete});await expect(decide(context)).rejects.toThrow();
 expect(port.complete).toHaveBeenCalledTimes(1);expect(port.finishNativeModel).toHaveBeenCalledWith('thread','op','1',{model:'gpt-6-luna',usage:null,reason:'provider_outcome_unknown'});
});
it('records observed usage even when returned JSON fails the proposal schema',async()=>{
 const port=fixture();port.complete.mockImplementation(async(_request,options)=>{options.onUsage({inputTokens:100,outputTokens:20,cachedInputTokens:40,reasoningTokens:10},'gpt-6-luna');throw Error('Invalid JSON');});
 const decide=createNativeModelDecision({store:port,threadId:'thread',requestKey:'event',complete:port.complete});await expect(decide(context)).rejects.toThrow();
 expect(port.finishNativeModel).toHaveBeenCalledWith('thread','op','1',{model:'gpt-6-luna',usage:{inputTokens:100,outputTokens:20,cachedInputTokens:40,reasoningTokens:10},reason:'provider_response_invalid'});
});

it.each([{inputTokens:100,outputTokens:20,cachedInputTokens:101,reasoningTokens:0},{inputTokens:100,outputTokens:20,cachedInputTokens:0,reasoningTokens:21}])('retains an unknown receipt for inconsistent token subcounts %j',async usage=>{
 const port=fixture();port.complete.mockImplementation(async(_request,options)=>{options.onUsage(usage,'gpt-6-luna');return {response:{decision:response},model:'gpt-6-luna',usage};});
 await expect(createNativeModelDecision({store:port,threadId:'thread',requestKey:'event',complete:port.complete})(context)).rejects.toThrow();
 expect(port.finishNativeModel).toHaveBeenCalledWith('thread','op','1',expect.objectContaining({model:'gpt-6-luna',usage:null,reason:'provider_outcome_unknown',responseFailure:expect.objectContaining({category:'usage_invalid'})}));
});
it('uses an object envelope for OpenAI structured output and persists only its validated inner decision',async()=>{
 const port=fixture();port.complete.mockImplementation(async(_input,options)=>{options.onUsage({inputTokens:100,outputTokens:20,cachedInputTokens:0,reasoningTokens:0},'gpt-6-luna');return {response:{decision:response},model:'gpt-6-luna',usage:{inputTokens:100,outputTokens:20,cachedInputTokens:0,reasoningTokens:0}};});
 expect(await createNativeModelDecision({store:port,threadId:'thread',requestKey:'envelope',complete:port.complete})(context)).toEqual(response);
 const schema=port.complete.mock.calls[0][0].json_schema;expect(schema.type).toBe('object');expect(schema.anyOf).toBeUndefined();expect(schema.required).toEqual(['decision']);expect(port.finishNativeModel).toHaveBeenCalledWith('thread','op','1',expect.objectContaining({response}));
});
it('records a typed definite request rejection without making a second provider request',async()=>{
 const {OpenAiProviderRejection}=await import('@/adapters/ai/openai'),port=fixture(),rejection={httpStatus:400,category:'invalid_request',code:'invalid_json_schema',parameter:'response_format'} as const;port.complete.mockRejectedValue(new OpenAiProviderRejection(rejection));
 await expect(createNativeModelDecision({store:port,threadId:'thread',requestKey:'reject',complete:port.complete})(context)).rejects.toThrow('needs review');expect(port.complete).toHaveBeenCalledTimes(1);expect(port.finishNativeModel).toHaveBeenCalledWith('thread','op','1',{model:'gpt-6-luna',usage:null,reason:'provider_request_rejected',rejection});
});
it('uses reviewed write-inclusive future ceilings and an explicit local-only cheaper-model comparison spec',async()=>{
 const {nativeModelSpecification}=await import('./agent-model-decision');expect(nativeModelSpecification.inputPriceMicroUsdPerMillion).toBe('125000');const port=fixture();port.complete.mockImplementation(async(_input,options)=>{options.onUsage({inputTokens:100,outputTokens:20,cachedInputTokens:0,reasoningTokens:10},'gpt-5-nano');return {response:{decision:response},model:'gpt-5-nano',usage:{inputTokens:100,outputTokens:20,cachedInputTokens:0,reasoningTokens:10}};});await createNativeModelDecision({store:port,threadId:'thread',requestKey:'comparison',complete:port.complete,evaluationModel:'gpt-5-nano'})(context);expect(port.beginNativeModel).toHaveBeenCalledWith('thread','comparison',expect.objectContaining({model:'gpt-5-nano',inputPriceMicroUsdPerMillion:'50000',outputPriceMicroUsdPerMillion:'400000'}),undefined);expect(port.complete.mock.calls[0][0].reasoning_effort).toBe('minimal');
});

it('instructs channel-specific drafts, person-wide reply coordination and bounded long-term reminders',async()=>{
 const port=fixture();await createNativeModelDecision({store:port,threadId:'thread',requestKey:'multichannel-policy',complete:port.complete})(context);
 const instruction=port.complete.mock.calls[0][0].messages[0].content;
 for(const required of ['routeId','reply_whatsapp','reply_linkedin','366 days','already answered','same channel'])expect(instruction).toContain(required);
 expect(instruction).not.toContain('within30 days');
});
it('uses a trusted local test-hours instruction only for the exact operator simulator profile',async()=>{
 const env={AGENT_MODE_SIMULATOR_TEST_POLICY:'true',NODE_ENV:'development',AGENT_MODE_COMMUNICATIONS_MODE:'simulator',AGENT_WORKER_REQUIRE_MANDATE_SCOPE:'true',AGENT_WORKER_MANDATE_ID:'e7da3f8c-8c45-4aef-bac4-392b918e0025',COMMUNICATIONS_INTEGRATION_ID:'sim-agent-conversations-25-20261017',COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE:'sim-agent-conversations-25-20261017-v1',COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN:'https://127.0.0.1:5590',UNIPILE_API_URL:'https://127.0.0.1:5590',COMMUNICATIONS_SERVICE_URL:'https://127.0.0.1:5591',COMMUNICATIONS_REDIRECT_ORIGIN:'https://127.0.0.1:5591',COMMUNICATIONS_SETUP_NOTIFY_URL:'https://127.0.0.1:5591/v1/setup/notify',DATABASE_URL:'postgresql://fixture:fixture@postgres:5432/acquire_agent_mode',COMMUNICATIONS_DATABASE_URL:'postgresql://fixture:fixture@postgres:5432/acquire_agent_mode'};
 try{
  for(const [key,value]of Object.entries(env))vi.stubEnv(key,value);
  const port=fixture();await createNativeModelDecision({store:port,threadId:'thread',requestKey:'local-test',complete:port.complete})(context);
  expect(port.complete.mock.calls[0][0].messages[0].content).toContain('Trusted local simulator delivery policy');
  expect(port.beginNativeModel.mock.calls[0][2].promptVersion).toContain('simulator25');
  vi.stubEnv('COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN','https://remote.example');const denied=fixture();await expect(createNativeModelDecision({store:denied,threadId:'thread',requestKey:'unsafe-test',complete:denied.complete})(context)).rejects.toThrow();expect(denied.beginNativeModel).not.toHaveBeenCalled();expect(denied.complete).not.toHaveBeenCalled();
 }finally{vi.unstubAllEnvs();}
 const ordinary=fixture();await createNativeModelDecision({store:ordinary,threadId:'thread',requestKey:'normal',complete:ordinary.complete})(context);expect(ordinary.complete.mock.calls[0][0].messages[0].content).not.toContain('Trusted local simulator delivery policy');
});
it('persists safe schema diagnostics and usage for an overlong invitation without retry or leaking model text',async()=>{const port=fixture();port.complete.mockResolvedValue({response:{decision:{action:'draft',draft:{kind:'invitation_linkedin',intent:'initial',routeId:'00000000-0000-4000-8000-000000000001',subject:'',body:'x'.repeat(301),rationale:'Synthetic public evidence',sourceIds:[]}}},model:'gpt-6-luna',usage:{inputTokens:100,outputTokens:200,cachedInputTokens:0,reasoningTokens:0}});await expect(createNativeModelDecision({store:port,threadId:'thread',requestKey:'invalid-invitation',complete:port.complete})(context)).rejects.toThrow('needs review');expect(port.complete).toHaveBeenCalledTimes(1);expect(port.finishNativeModel).toHaveBeenCalledWith('thread','op','1',expect.objectContaining({reason:'provider_response_invalid',responseFailure:expect.objectContaining({version:1,category:'schema_validation',draftKind:'invitation_linkedin',issues:expect.arrayContaining([expect.objectContaining({path:'decision.draft.body',code:'too_big',maximum:300,length:301})])})}));});
it.each(['invalid_json','incomplete_response']as const)('accounts a typed %s response once with no raw provider content or retry',async category=>{const{OpenAiResponseFailure}=await import('@/adapters/ai/openai'),port=fixture();port.complete.mockImplementation(async(_request,options)=>{options.onUsage({inputTokens:100,outputTokens:30,cachedInputTokens:0,reasoningTokens:0},'gpt-6-luna');throw new OpenAiResponseFailure(category);});await expect(createNativeModelDecision({store:port,threadId:'thread',requestKey:'typed-failure',complete:port.complete})(context)).rejects.toThrow('needs review');expect(port.complete).toHaveBeenCalledTimes(1);expect(port.finishNativeModel).toHaveBeenCalledWith('thread','op','1',expect.objectContaining({reason:'provider_response_invalid',responseFailure:{version:1,category}}));});

it('distinguishes invitation planning from effect approval and supplies exact draft limits and grounding rules',async()=>{
 const port=fixture();await createNativeModelDecision({store:port,threadId:'thread',requestKey:'proposal-not-execution',complete:port.complete})(context);
 const request=port.complete.mock.calls[0][0],instruction=request.messages[0].content;
 expect(instruction).toContain('Human approval is required before execution, not before proposing an invitation draft');
 expect(instruction).toContain('Do not choose review solely because that draft will need human approval');
 expect(instruction).toContain('Email bodies and WhatsApp or LinkedIn message bodies: 1–6000 characters');
 expect(instruction).toContain('Invitation notes: 1–300 characters');
 expect(instruction).toContain('Never assert that introductions are free or that there are no fees unless explicitly approved public facts establish that');
 const objects:Record<string,unknown>[]=[];
 const walk=(value:unknown)=>{if(!value||typeof value!=='object')return;if(!Array.isArray(value))objects.push(value as Record<string,unknown>);for(const child of Object.values(value))walk(child);};walk(request.json_schema);
 const invitation=objects.find(value=>(value.properties as Record<string,{const?:string}>|undefined)?.kind?.const==='invitation_linkedin');
 expect(invitation).toBeDefined();expect((invitation!.properties as Record<string,unknown>).body).toEqual(expect.objectContaining({minLength:1,maxLength:300}));
 expect((invitation!.properties as Record<string,unknown>).subject).toEqual(expect.objectContaining({const:''}));
});
