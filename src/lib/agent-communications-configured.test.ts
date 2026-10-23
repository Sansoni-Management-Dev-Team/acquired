import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {ZodError} from 'zod';
vi.mock('server-only',()=>({}));
const f=vi.hoisted(()=>({query:vi.fn(),status:vi.fn(),admission:vi.fn(),refresh:vi.fn(),read:vi.fn(),recover:vi.fn(),dispatch:vi.fn(),saveIdentity:vi.fn(),settle:vi.fn(),policy:vi.fn(),catchup:vi.fn(),deliveryFactory:vi.fn(),capture:vi.fn(),localConfig:vi.fn(),hosted:vi.fn()}));
vi.mock('@/db/campaign-client',()=>({withCampaignDb:async(_actor:unknown,work:(c:unknown)=>unknown)=>work({query:f.query})}));
vi.mock('./agent-simulator-test-policy',()=>({localSimulatorTestPolicy:f.policy}));
vi.mock('./agent-recorded-reply-identity',()=>({registerNativeReplyIdentity:(actor:unknown,input:{identity:unknown})=>f.saveIdentity(actor,input.identity)}));
vi.mock('./communications-client',()=>({actorCommunicationsClient:async()=>({connectionStatus:f.status})}));
vi.mock('./communications-configuration',()=>({configuredAcquireCommunicationsForBinding:async()=>{f.localConfig();return({host:{admission:f.admission,refreshAndConsume:f.refresh,readAgentConversation:f.read,readAgentChannelConversation:f.read,revalidateAgentChannelCoverage:f.catchup}});}}));
vi.mock('./agent-communications-no-submission',()=>({settleAgentNoSubmission:f.settle}));
vi.mock('./agent-communications-delivery',()=>({createAgentCommunicationsDelivery:(ports:unknown)=>{f.deliveryFactory(ports);return {recover:f.recover,dispatch:f.dispatch};}}));
vi.mock('./communications-submission-projection',()=>({captureOriginalSubmission:f.capture}));
vi.mock('./hosted-demo-runtime',()=>({configuredHostedDemoRuntime:()=>({descriptor:{phase:'active'}})}));
vi.mock('./hosted-demo-native',()=>({createHostedDemoNativeFacade:()=>{f.hosted();return{admission:f.admission,readAgentConversation:f.read,readAgentChannelConversation:f.read,revalidateAgentChannelCoverage:f.catchup};}}));
afterEach(()=>vi.unstubAllEnvs());
import {configuredAgentCommunications} from './agent-communications-configured';
import {recordedAgentBindingDigest} from '@/db/agent-execution-store';
const operation='10000000-0000-4000-8000-000000000001',conversation='10000000-0000-4000-8000-000000000002';
const actor={organizationId:'org',userId:'user'},binding={id:'original-binding',application_id:'acquire',organization_id:'org',owner_user_id:'user',service_connection_id:'original-connection',service_account_id:'original-account',generation:1,channel:'email',platform:'gmail',backend:'unipile',authority:'service'};
beforeEach(()=>{f.saveIdentity.mockResolvedValue(undefined);});
function fixture(){const row={history:[],delivery_mode:'communications',binding_id:binding.id,binding_digest:recordedAgentBindingDigest(binding),contact_id:'contact',recipient_email:'person@example.invalid'},store={preBeginHistoryRetryProof:vi.fn(async()=>true),conversation:vi.fn(async()=>row),ingestHistory:vi.fn(),beginNativeCommunicationsEmail:vi.fn(async()=>({operationId:operation,conversationId:conversation,epoch:1,fence:'2',bindingId:binding.id,recipient:row.recipient_email,subject:'Synthetic',body:'Synthetic body'}))};return {row,store,service:configuredAgentCommunications(actor,store as never)};}
beforeEach(()=>{vi.clearAllMocks();f.catchup.mockImplementation(async(selected:Array<{bindingId:string;scopeDigest:string}>)=>selected.map(({bindingId,scopeDigest})=>({bindingId,scopeDigest})));f.policy.mockReturnValue(false);f.query.mockImplementation(async(sql:string)=>sql.includes('agent_communications_source')?{rows:[{source:{contactId:'10000000-0000-4000-8000-000000000003',recipient:'person@example.invalid',subject:'Synthetic',body:'Synthetic body',contextDigest:'a'.repeat(64),requiredSince:'1970-01-01T00:00:00.000Z',replyParent:null}}]}:{rows:[binding]});f.status.mockResolvedValue({status:'connected'});f.admission.mockResolvedValue({});f.recover.mockResolvedValue({found:false});f.refresh.mockResolvedValue({});f.read.mockResolvedValue({source:'communications',complete:true,observedAt:'2026-10-17T00:00:00.000Z',messages:[],scopeDigest:'a'.repeat(64)});f.dispatch.mockResolvedValue({status:'unknown'});});
it('recovers original receipts before refresh, changed history or fresh authority',async()=>{const x=fixture();f.recover.mockResolvedValue({found:true,outcome:{status:'submitted',receipt:{}}});expect(await x.service.dispatch('thread',conversation,operation)).toMatchObject({status:'submitted'});expect(f.read).not.toHaveBeenCalled();expect(f.refresh).not.toHaveBeenCalled();expect(x.store.beginNativeCommunicationsEmail).not.toHaveBeenCalled();expect(f.dispatch).not.toHaveBeenCalled();});
it('refreshes complete original-account history and then starts exact native admission',async()=>{const x=fixture();await x.service.dispatch('thread',conversation,operation);expect(f.read).toHaveBeenCalledWith(expect.objectContaining({connectionId:'original-connection',accountId:'original-account',generation:1}),'person@example.invalid');expect(f.refresh).not.toHaveBeenCalled();expect(x.store.ingestHistory).toHaveBeenCalledWith('thread',conversation,{source:'communications',complete:true,observedAt:'2026-10-17T00:00:00.000Z',messages:[]});expect(f.dispatch).toHaveBeenCalledWith(expect.objectContaining({source:{kind:'agent',operationId:operation,conversationId:conversation,epoch:1,fence:'2'},coverageScopes:[{bindingId:binding.id,scopeDigest:'a'.repeat(64)}]}));});
it('fails closed on incomplete body history before authority or submit',async()=>{const x=fixture();f.read.mockResolvedValue({complete:false,messages:[]});await expect(x.service.dispatch('thread',conversation,operation)).rejects.toMatchObject({historyError:expect.objectContaining({message:expect.stringContaining('history needs human review')})});expect(x.store.ingestHistory).not.toHaveBeenCalled();expect(x.store.beginNativeCommunicationsEmail).not.toHaveBeenCalled();expect(f.dispatch).not.toHaveBeenCalled();});
it('never substitutes a changed binding generation or a new default',async()=>{const x=fixture();f.query.mockResolvedValue({rows:[{...binding,generation:2}]});await expect(x.service.refresh('thread',conversation)).rejects.toThrow('Original native account changed');expect(f.status).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();});

it('records the canonical native recipient before consuming provider events',async()=>{const x=fixture();await x.service.refresh('thread',conversation);expect(f.saveIdentity).toHaveBeenCalledWith(actor,expect.objectContaining({contactId:'contact',email:'person@example.invalid',identity:'person@example.invalid',sourceIdentity:'person@example.invalid',channel:'email',authority:'service',since:new Date('1970-01-01T00:00:00.000Z')}));expect(f.saveIdentity.mock.invocationCallOrder[0]).toBeLessThan(f.read.mock.invocationCallOrder[0]);});

it('settles only authenticated no-submission recovery before reporting it complete, with no new authority or send',async()=>{
 const x=fixture(),noSubmission={intentId:'10000000-0000-4000-8000-000000000004',operationKey:'original-key',proofDigest:'b'.repeat(64)};f.recover.mockResolvedValue({found:true,noSubmission});f.settle.mockResolvedValue({status:'not_submitted'});expect(await x.service.recover('thread',conversation,operation)).toEqual({found:true,noSubmission});expect(f.settle).toHaveBeenCalledWith(actor,operation,noSubmission);expect(f.read).not.toHaveBeenCalled();expect(x.store.beginNativeCommunicationsEmail).not.toHaveBeenCalled();expect(f.dispatch).not.toHaveBeenCalled();
});
it('does not report no-submission completion when scoped ledger settlement is unavailable',async()=>{const x=fixture();f.recover.mockResolvedValue({found:true,noSubmission:{intentId:'10000000-0000-4000-8000-000000000004',operationKey:'original-key',proofDigest:'b'.repeat(64)}});f.settle.mockRejectedValue(Error('Ledger unavailable'));await expect(x.service.recover('thread',conversation,operation)).rejects.toThrow('Ledger unavailable');expect(f.dispatch).not.toHaveBeenCalled();expect(x.store.beginNativeCommunicationsEmail).not.toHaveBeenCalled();});
it('persists a verified delivery-failure hold before declining native authority, rather than losing the bounce behind an exception',async()=>{
 const x=fixture(),history={source:'communications',complete:false,observedAt:'2026-10-17T00:00:00.000Z',messages:[],deliveryFailures:[{id:'dsn-original',at:'2026-10-16T23:00:00.000Z'}]};f.read.mockResolvedValue(history);
 await expect(x.service.dispatch('thread',conversation,operation)).rejects.toMatchObject({historyError:expect.objectContaining({message:expect.stringContaining('history needs human review')})});
 expect(x.store.ingestHistory).toHaveBeenCalledWith('thread',conversation,history);expect(x.store.beginNativeCommunicationsEmail).not.toHaveBeenCalled();expect(f.dispatch).not.toHaveBeenCalled();
});

it('emits only gated fixed pre-intent metadata and preserves the exact error with no retry',async()=>{f.policy.mockReturnValue(true);const logs=vi.spyOn(console,'warn').mockImplementation(()=>{}),x=fixture(),cause=Object.assign(Error('PRIVATE body URL key'),{code:'40001',detail:'PRIVATE SQL'});f.read.mockRejectedValue(cause);try{await expect(x.service.dispatch('thread',conversation,operation)).rejects.toMatchObject({historyError:cause});expect(f.read).toHaveBeenCalledTimes(1);expect(x.store.beginNativeCommunicationsEmail).not.toHaveBeenCalled();expect(logs).toHaveBeenCalledWith(JSON.stringify({component:'local-simulator-native-communications',stage:'refresh.read_history',outcome:'error',errorName:'Error',sqlState:'40001'}));expect(JSON.stringify(logs.mock.calls)).not.toContain('PRIVATE');expect(JSON.stringify(logs.mock.calls)).not.toContain(operation);}finally{logs.mockRestore();}});
it('stays silent outside exact local policy and ignores failing diagnostic sinks',async()=>{const logs=vi.spyOn(console,'warn').mockImplementation(()=>{throw Error('logger broken');});try{const x=fixture();await x.service.refresh('thread',conversation);expect(logs).not.toHaveBeenCalled();f.policy.mockReturnValue(true);await expect(x.service.refresh('thread',conversation)).resolves.toHaveLength(1);expect(logs).toHaveBeenCalled();}finally{logs.mockRestore();}});
it('never reads diagnostic getters or prints unknown provider error metadata',async()=>{f.policy.mockReturnValue(true);const logs=vi.spyOn(console,'warn').mockImplementation(()=>{}),getter=vi.fn(()=>{throw Error('PRIVATE getter');}),cause={};Object.defineProperties(cause,{name:{get:getter},code:{get:getter},message:{get:getter}});f.saveIdentity.mockRejectedValue(cause);try{const x=fixture();await expect(x.service.refresh('thread',conversation)).rejects.toBe(cause);expect(getter).not.toHaveBeenCalled();expect(logs).toHaveBeenCalledWith(JSON.stringify({component:'local-simulator-native-communications',stage:'refresh.save_identity',outcome:'error'}));expect(f.read).not.toHaveBeenCalled();}finally{logs.mockRestore();}});

it('refreshes every recorded person channel, scopes colliding provider IDs and saves all identities before consuming replies',async()=>{
 const channels=['email','whatsapp','linkedin'] as const;
 const accounts=channels.map((channel,i)=>({...binding,id:`40000000-0000-4000-8000-00000000000${i+1}`,channel,platform:channel==='email'?'gmail':channel,service_connection_id:'connection-'+channel,service_account_id:'account-'+channel}));
 const routes=accounts.map((b,i)=>({id:`50000000-0000-4000-8000-00000000000${i+1}`,conversationId:conversation,channel:b.channel,bindingId:b.id,bindingDigest:recordedAgentBindingDigest(b),recipient:{kind:b.channel==='email'?'email':b.channel==='whatsapp'?'phone':'linkedin_profile',value:b.channel==='email'?'person@example.invalid':b.channel==='whatsapp'?'+61400000002':'https://www.linkedin.com/in/peer'}}));
 const x=fixture(),ingestChannelHistory=vi.fn(),store={...x.store,channelRoutes:vi.fn(async()=>routes),ingestChannelHistory};
 f.query.mockImplementation(async(_sql:string,values:unknown[])=>({rows:accounts.filter(b=>b.id===values[0])}));
 f.read.mockImplementation(async(selected)=>({binding:selected,source:'communications',complete:true,observedAt:'2026-10-17T00:00:00.000Z',messages:[{id:'same-provider-message-id',direction:'inbound',text:'Verified peer question',at:'2026-10-16T23:59:00.000Z',...(selected.channel!=='email'?{providerConversationId:'chat-'+selected.channel}:{})}],scopeDigest:'a'.repeat(64)}));
 const result=await configuredAgentCommunications(actor,store as never).refresh('thread',conversation);
 expect(result).toHaveLength(3);expect(ingestChannelHistory).toHaveBeenCalledTimes(3);expect(x.store.ingestHistory).not.toHaveBeenCalled();expect(f.catchup).toHaveBeenCalledWith(routes.map((route,i)=>({binding:expect.objectContaining({accountId:accounts[i].service_account_id}),bindingId:route.bindingId,scopeDigest:'a'.repeat(64)})));expect(f.catchup.mock.invocationCallOrder[0]).toBeGreaterThan(Math.max(...f.read.mock.invocationCallOrder));
 const messages=ingestChannelHistory.mock.calls.map(call=>call[3].messages[0]);expect(new Set(messages.map(m=>m.id)).size).toBe(3);
 for(const [i,message]of messages.entries())expect(message).toMatchObject({id:expect.stringMatching(/^channel-message:[a-f0-9]{64}$/),providerMessageId:'same-provider-message-id',routeId:routes[i].id,channel:routes[i].channel,bindingDigest:routes[i].bindingDigest});
 expect(Math.max(...f.saveIdentity.mock.invocationCallOrder)).toBeLessThan(Math.min(...f.read.mock.invocationCallOrder));
});

it('refuses a changed recorded social route without consulting defaults or ingesting another account history',async()=>{
 const x=fixture(),route={id:'50000000-0000-4000-8000-000000000001',conversationId:conversation,channel:'whatsapp',bindingId:binding.id,bindingDigest:'b'.repeat(64),recipient:{kind:'phone',value:'+61400000002'}},ingestChannelHistory=vi.fn();
 const service=configuredAgentCommunications(actor,{...x.store,channelRoutes:vi.fn(async()=>[route]),ingestChannelHistory} as never);
 await expect(service.refresh('thread',conversation)).rejects.toThrow(/account changed|route/i);expect(ingestChannelHistory).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();
});

it('continues all three verified reads when ingestion preserves an existing human hold',async()=>{
 const channels=['email','whatsapp','linkedin'] as const;
 const accounts=channels.map((channel,i)=>({...binding,id:`40000000-0000-4000-8000-00000000000${i+1}`,channel,platform:channel==='email'?'gmail':channel,service_connection_id:'connection-'+channel,service_account_id:'account-'+channel}));
 const routes=accounts.map((b,i)=>({id:`50000000-0000-4000-8000-00000000000${i+1}`,conversationId:conversation,channel:b.channel,bindingId:b.id,bindingDigest:recordedAgentBindingDigest(b),recipient:{kind:b.channel==='email'?'email':b.channel==='whatsapp'?'phone':'linkedin_profile',value:b.channel==='email'?'person@example.invalid':b.channel==='whatsapp'?'+61400000002':'https://www.linkedin.com/in/peer'}}));
 const x=fixture(),ingestChannelHistory=vi.fn(async(_thread:string,_conversation:string,_route:string,_history:{messages:Array<Record<string,unknown>>})=>{void [_thread,_conversation,_route,_history];return {status:'held',historyAccepted:true};}),store={...x.store,channelRoutes:vi.fn(async()=>routes),ingestChannelHistory};
 f.query.mockImplementation(async(_sql:string,values:unknown[])=>({rows:accounts.filter(b=>b.id===values[0])}));
 f.read.mockImplementation(async(selected)=>({binding:selected,source:'communications',complete:true,observedAt:'2026-10-17T00:00:00.000Z',messages:[{id:'same-provider-message-id',direction:'inbound',text:'Verified peer question',at:'2026-10-16T23:59:00.000Z',...(selected.channel!=='email'?{providerConversationId:'chat-'+selected.channel}:{})}],scopeDigest:'a'.repeat(64)}));
 const result=await configuredAgentCommunications(actor,store as never).refresh('thread',conversation);
 expect(result).toHaveLength(3);expect(ingestChannelHistory).toHaveBeenCalledTimes(3);expect(x.store.ingestHistory).not.toHaveBeenCalled();expect(f.catchup).toHaveBeenCalledWith(routes.map((route,i)=>({binding:expect.objectContaining({accountId:accounts[i].service_account_id}),bindingId:route.bindingId,scopeDigest:'a'.repeat(64)})));expect(f.catchup.mock.invocationCallOrder[0]).toBeGreaterThan(Math.max(...f.read.mock.invocationCallOrder));
 const messages=ingestChannelHistory.mock.calls.map(call=>call[3].messages[0]);expect(new Set(messages.map(m=>m.id)).size).toBe(3);
 for(const [i,message]of messages.entries())expect(message).toMatchObject({id:expect.stringMatching(/^channel-message:[a-f0-9]{64}$/),providerMessageId:'same-provider-message-id',routeId:routes[i].id,channel:routes[i].channel,bindingDigest:routes[i].bindingDigest});
 expect(Math.max(...f.saveIdentity.mock.invocationCallOrder)).toBeLessThan(Math.min(...f.read.mock.invocationCallOrder));
});

it('rejects a genuine new history conflict before reading another route',async()=>{
 const channels=['email','whatsapp','linkedin'] as const;
 const accounts=channels.map((channel,i)=>({...binding,id:`40000000-0000-4000-8000-00000000000${i+1}`,channel,platform:channel==='email'?'gmail':channel,service_connection_id:'connection-'+channel,service_account_id:'account-'+channel}));
 const routes=accounts.map((b,i)=>({id:`50000000-0000-4000-8000-00000000000${i+1}`,conversationId:conversation,channel:b.channel,bindingId:b.id,bindingDigest:recordedAgentBindingDigest(b),recipient:{kind:b.channel==='email'?'email':b.channel==='whatsapp'?'phone':'linkedin_profile',value:b.channel==='email'?'person@example.invalid':b.channel==='whatsapp'?'+61400000002':'https://www.linkedin.com/in/peer'}}));
 const x=fixture(),ingestChannelHistory=vi.fn(async(_thread:string,_conversation:string,_route:string,_history:{messages:Array<Record<string,unknown>>})=>{void [_thread,_conversation,_route,_history];return {status:'held',historyAccepted:false};}),store={...x.store,channelRoutes:vi.fn(async()=>routes),ingestChannelHistory};
 f.query.mockImplementation(async(_sql:string,values:unknown[])=>({rows:accounts.filter(b=>b.id===values[0])}));
 f.read.mockImplementation(async(selected)=>({binding:selected,source:'communications',complete:true,observedAt:'2026-10-17T00:00:00.000Z',messages:[{id:'same-provider-message-id',direction:'inbound',text:'Verified peer question',at:'2026-10-16T23:59:00.000Z',...(selected.channel!=='email'?{providerConversationId:'chat-'+selected.channel}:{})}],scopeDigest:'a'.repeat(64)}));
 await expect(configuredAgentCommunications(actor,store as never).refresh('thread',conversation)).rejects.toThrow('history has a conflict');
 expect(ingestChannelHistory).toHaveBeenCalledTimes(1);expect(f.read).toHaveBeenCalledTimes(1);expect(f.dispatch).not.toHaveBeenCalled();
});

it('fails closed on a held history result without explicit acceptance',async()=>{
 const channels=['email','whatsapp','linkedin'] as const;
 const accounts=channels.map((channel,i)=>({...binding,id:`40000000-0000-4000-8000-00000000000${i+1}`,channel,platform:channel==='email'?'gmail':channel,service_connection_id:'connection-'+channel,service_account_id:'account-'+channel}));
 const routes=accounts.map((b,i)=>({id:`50000000-0000-4000-8000-00000000000${i+1}`,conversationId:conversation,channel:b.channel,bindingId:b.id,bindingDigest:recordedAgentBindingDigest(b),recipient:{kind:b.channel==='email'?'email':b.channel==='whatsapp'?'phone':'linkedin_profile',value:b.channel==='email'?'person@example.invalid':b.channel==='whatsapp'?'+61400000002':'https://www.linkedin.com/in/peer'}}));
 const x=fixture(),ingestChannelHistory=vi.fn(async(_thread:string,_conversation:string,_route:string,_history:{messages:Array<Record<string,unknown>>})=>{void [_thread,_conversation,_route,_history];return {status:'held'};}),store={...x.store,channelRoutes:vi.fn(async()=>routes),ingestChannelHistory};
 f.query.mockImplementation(async(_sql:string,values:unknown[])=>({rows:accounts.filter(b=>b.id===values[0])}));
 f.read.mockImplementation(async(selected)=>({binding:selected,source:'communications',complete:true,observedAt:'2026-10-17T00:00:00.000Z',messages:[{id:'same-provider-message-id',direction:'inbound',text:'Verified peer question',at:'2026-10-16T23:59:00.000Z',...(selected.channel!=='email'?{providerConversationId:'chat-'+selected.channel}:{})}],scopeDigest:'a'.repeat(64)}));
 await expect(configuredAgentCommunications(actor,store as never).refresh('thread',conversation)).rejects.toThrow('history has a conflict');
 expect(ingestChannelHistory).toHaveBeenCalledTimes(1);expect(f.read).toHaveBeenCalledTimes(1);expect(f.dispatch).not.toHaveBeenCalled();
});

it('does not begin sending when original coverage cannot catch up after all verified reads',async()=>{
 const channels=['email','whatsapp','linkedin'] as const;
 const accounts=channels.map((channel,i)=>({...binding,id:`40000000-0000-4000-8000-00000000000${i+1}`,channel,platform:channel==='email'?'gmail':channel,service_connection_id:'connection-'+channel,service_account_id:'account-'+channel}));
 const routes=accounts.map((b,i)=>({id:`50000000-0000-4000-8000-00000000000${i+1}`,conversationId:conversation,channel:b.channel,bindingId:b.id,bindingDigest:recordedAgentBindingDigest(b),recipient:{kind:b.channel==='email'?'email':b.channel==='whatsapp'?'phone':'linkedin_profile',value:b.channel==='email'?'person@example.invalid':b.channel==='whatsapp'?'+61400000002':'https://www.linkedin.com/in/peer'}}));
 const x=fixture(),ingestChannelHistory=vi.fn(async(_thread:string,_conversation:string,_route:string,_history:{messages:Array<Record<string,unknown>>})=>{void [_thread,_conversation,_route,_history];return {status:'held',historyAccepted:true};}),store={...x.store,channelRoutes:vi.fn(async()=>routes),ingestChannelHistory};
 f.query.mockImplementation(async(_sql:string,values:unknown[])=>({rows:accounts.filter(b=>b.id===values[0])}));
 f.read.mockImplementation(async(selected)=>({binding:selected,source:'communications',complete:true,observedAt:'2026-10-17T00:00:00.000Z',messages:[{id:'same-provider-message-id',direction:'inbound',text:'Verified peer question',at:'2026-10-16T23:59:00.000Z',...(selected.channel!=='email'?{providerConversationId:'chat-'+selected.channel}:{})}],scopeDigest:'a'.repeat(64)}));
 Object.assign(store,{channelDispatchRecord:vi.fn(async()=>({conversation:{...x.row,id:conversation},operation:{input:{routeId:routes[0].id}},route:routes[0],submitted:false,notSubmitted:false}))});
 f.catchup.mockRejectedValue(Error('Original channel coverage changed during revalidation'));
 await expect(configuredAgentCommunications(actor,store as never).dispatch('thread',conversation,operation)).rejects.toThrow('before outbound admission');expect(f.read).toHaveBeenCalledTimes(3);expect(x.store.beginNativeCommunicationsEmail).not.toHaveBeenCalled();expect(f.dispatch).not.toHaveBeenCalled();
});

it('never wraps or retries a failure after native begin or inside the delivery port',async()=>{
 const x=fixture(),beginError=Error('Private post-begin authority failure');x.store.beginNativeCommunicationsEmail.mockRejectedValueOnce(beginError);await expect(x.service.dispatch('thread',conversation,operation)).rejects.toBe(beginError);expect(x.store.beginNativeCommunicationsEmail).toHaveBeenCalledOnce();expect(f.dispatch).not.toHaveBeenCalled();
 const later=fixture(),deliveryError=Error('Private provider outcome uncertainty');f.dispatch.mockRejectedValueOnce(deliveryError);await expect(later.service.dispatch('thread',conversation,operation)).rejects.toBe(deliveryError);expect(later.store.beginNativeCommunicationsEmail).toHaveBeenCalledOnce();
});

it.each(['sql','schema'] as const)('observes a WhatsApp %s source failure after native begin without exposing its error or starting delivery',async kind=>{
 const x=fixture(),account={...binding,id:'40000000-0000-4000-8000-000000000001',channel:'whatsapp',platform:'whatsapp'},route={id:'50000000-0000-4000-8000-000000000001',conversationId:conversation,channel:'whatsapp',bindingId:account.id,bindingDigest:recordedAgentBindingDigest(account),recipient:{kind:'phone',value:'+999558427011936'}},cause=kind==='sql'?Object.assign(Error('PRIVATE source SQL and message body'),{code:'42501'}):new ZodError([{code:'custom',path:['PRIVATE source field'],message:'PRIVATE body'}]);
 const store={...x.store,channelRoutes:vi.fn(async()=>[route]),ingestChannelHistory:vi.fn(),channelDispatchRecord:vi.fn(async()=>({conversation:{...x.row,id:conversation},operation:{input:{routeId:route.id}},route,submitted:false,notSubmitted:false})),beginNativeCommunicationsMessage:vi.fn(async()=>({operationId:operation,conversationId:conversation,routeId:route.id,epoch:3,fence:'1',bindingId:account.id,recipient:route.recipient,channel:'whatsapp',subject:'',body:'Reviewed WhatsApp body'}))};
 f.query.mockImplementation(async(sql:string)=>{if(sql.includes('agent_channel_communications_source'))throw cause;return{rows:[account]};});
 f.read.mockImplementation(async selected=>({binding:selected,source:'communications',complete:true,observedAt:'2026-10-17T00:00:00.000Z',messages:[],scopeDigest:'a'.repeat(64)}));
 vi.stubEnv('AGENT_VERBOSE_LOGGING','true');const logs=vi.spyOn(console,'info').mockImplementation(()=>{});
 try{await expect(configuredAgentCommunications(actor,store as never).dispatch('thread',conversation,operation)).rejects.toBe(cause);
  expect(store.beginNativeCommunicationsMessage).toHaveBeenCalledOnce();expect(f.dispatch).not.toHaveBeenCalled();
  const observations=logs.mock.calls.filter(([prefix])=>prefix==='agent-pipeline').map(([,json])=>JSON.parse(json as string));
  expect(observations).toContainEqual(expect.objectContaining({stage:'dispatch.source',outcome:'error',...(kind==='sql'?{sqlState:'42501'}:{errorClass:'ZodError'})}));
  expect(JSON.stringify(logs.mock.calls)).not.toContain('PRIVATE');expect(JSON.stringify(logs.mock.calls)).not.toContain('Reviewed WhatsApp body');
 }finally{logs.mockRestore();vi.unstubAllEnvs();}
});

it('cannot label a history read as pre-begin when fresh persisted safety proof is false, missing or unavailable',async()=>{
 for(const variant of ['running','uncertain','prior_intent','authority','send_reservation','missing','unavailable']){const f0=fixture(),cause=Error('Original private history read failure');f.read.mockRejectedValueOnce(cause);if(variant==='missing')delete (f0.store as Partial<typeof f0.store>).preBeginHistoryRetryProof;else if(variant==='unavailable')f0.store.preBeginHistoryRetryProof.mockRejectedValueOnce(Error('Proof query unavailable'));else f0.store.preBeginHistoryRetryProof.mockResolvedValueOnce(false);await expect(f0.service.dispatch('thread',conversation,operation)).rejects.toBe(cause);expect(f0.store.beginNativeCommunicationsEmail).not.toHaveBeenCalled();}
});

it.each(['message','invitation'] as const)('wires exact original native %s capture independently of current history',async(effect)=>{const x=fixture();await x.service.dispatch('thread',conversation,operation);const ports=f.deliveryFactory.mock.calls[0][0];const receipt={submittedAt:'2026-10-17T00:00:00Z',...(effect==='message'?{message:{id:'provider-message'}}:{operation:{id:'provider-action'}})};await ports.recordSubmitted(operation,{status:'submitted',receipt});expect(f.capture).toHaveBeenCalledWith(actor,{bindingId:binding.id,binding:expect.objectContaining({accountId:binding.service_account_id,generation:binding.generation}),sourceKind:'agent',sourceId:operation},{effect,providerReference:effect==='message'?'provider-message':'provider-action',submittedAt:receipt.submittedAt});});

function recordedDispatchFixture(channel:'email'|'whatsapp'|'linkedin'){
 const x=fixture(),account={...binding,id:'40000000-0000-4000-8000-000000000001',channel,platform:channel==='email'?'gmail':channel},recipient={kind:channel==='email'?'email':channel==='whatsapp'?'phone':'linkedin_profile',value:channel==='email'?'person@example.invalid':channel==='whatsapp'?'+999558427011936':'https://www.linkedin.com/in/sim-person'};
 const route={id:'50000000-0000-4000-8000-000000000001',conversationId:conversation,channel,bindingId:account.id,bindingDigest:recordedAgentBindingDigest(account),recipient},routes=[structuredClone(route)],subject=channel==='email'?'Synthetic':'';
 const store={...x.store,channelRoutes:vi.fn(async()=>routes),ingestChannelHistory:vi.fn(),channelDispatchRecord:vi.fn(async()=>({conversation:{...x.row,id:conversation},operation:{input:{routeId:route.id}},route:structuredClone(route),submitted:false,notSubmitted:false})),beginNativeCommunicationsMessage:vi.fn(async()=>({operationId:operation,conversationId:conversation,routeId:route.id,epoch:3,fence:'1',bindingId:account.id,recipient,channel,subject,body:'Synthetic body'}))};
 f.query.mockImplementation(async(sql:string)=>sql.includes('agent_channel_communications_source')?{rows:[{source:{contactId:'10000000-0000-4000-8000-000000000003',routeId:route.id,channel,recipient,subject,body:'Synthetic body',contextDigest:'a'.repeat(64),requiredSince:'1970-01-01T00:00:00.000Z',replyParent:null,conversation:null,coverageRoutes:[{bindingId:account.id,channel,recipient}]}}]}:{rows:[account]});
 f.read.mockImplementation(async selected=>({binding:selected,source:'communications',complete:true,observedAt:'2026-10-17T00:00:00.000Z',messages:[],scopeDigest:'a'.repeat(64)}));
 return{store,routes,service:configuredAgentCommunications(actor,store as never)};
}
it.each(['email','whatsapp','linkedin']as const)('loads exact %s dispatch ports once while still refreshing current routes, history, coverage and final source',async channel=>{
 const x=recordedDispatchFixture(channel);await x.service.dispatch('thread',conversation,operation);
 expect(f.status).toHaveBeenCalledOnce();expect(f.admission).toHaveBeenCalledOnce();
 expect(x.store.channelRoutes).toHaveBeenCalledOnce();expect(f.read).toHaveBeenCalledOnce();expect(f.catchup).toHaveBeenCalledOnce();expect(x.store.beginNativeCommunicationsMessage).toHaveBeenCalledOnce();expect(f.dispatch).toHaveBeenCalledOnce();
 expect(f.recover.mock.invocationCallOrder[0]).toBeLessThan(f.read.mock.invocationCallOrder[0]);expect(f.read.mock.invocationCallOrder[0]).toBeLessThan(x.store.beginNativeCommunicationsMessage.mock.invocationCallOrder[0]);
});
it('revalidates changed route identity rather than reusing an earlier account observation',async()=>{
 const x=recordedDispatchFixture('whatsapp');f.recover.mockImplementationOnce(async()=>{x.routes[0]={...x.routes[0],bindingDigest:'b'.repeat(64)};return{found:false};});
 await expect(x.service.dispatch('thread',conversation,operation)).rejects.toThrow('before outbound admission');expect(f.read).not.toHaveBeenCalled();expect(x.store.beginNativeCommunicationsMessage).not.toHaveBeenCalled();expect(f.dispatch).not.toHaveBeenCalled();
});
it('does not retain prepared ports across separate dispatch calls',async()=>{
 const x=recordedDispatchFixture('email');await x.service.dispatch('thread',conversation,operation);await x.service.dispatch('thread',conversation,operation);
 expect(f.status).toHaveBeenCalledTimes(2);expect(f.read).toHaveBeenCalledTimes(2);expect(x.store.beginNativeCommunicationsMessage).toHaveBeenCalledTimes(2);
});
it('uses only per-operation scoped communications ports and passes the same business clock into original delivery',async()=>{const{createAgentBusinessTimeContext}=await import('./agent-business-time'),scope={runId:'native-clock-proof',...actor},context=createAgentBusinessTimeContext(scope,{now:()=>Date.parse('2030-01-07T00:00:00.000Z')}),x=fixture(),read=vi.fn(async()=>({source:'communications',complete:true,observedAt:'2030-01-07T00:00:00.000Z',messages:[],scopeDigest:'a'.repeat(64)})),status=vi.fn(async()=>({status:'connected'})),actorClient=vi.fn(async()=>({connectionStatus:status})),host={admission:vi.fn(async()=>({})),readAgentConversation:read},applicationPool={connect:vi.fn()};f.query.mockImplementation(async(sql:string)=>sql.includes('AS coherent')?{rows:[{coherent:true}]}:{rows:[binding]});const service=configuredAgentCommunications(actor,x.store as never,{businessTime:{context,scope},host:host as never,actorClient:actorClient as never,applicationPool:applicationPool as never,applicationCodec:{} as never});await service.refresh('thread',conversation);expect(read).toHaveBeenCalledOnce();expect(f.read).not.toHaveBeenCalled();expect(actorClient).toHaveBeenCalledWith(actor);expect(f.deliveryFactory).toHaveBeenCalledWith(expect.objectContaining({businessClock:context}));expect(f.query.mock.calls.some(([sql])=>sql.includes('AS coherent'))).toBe(true);});
it('refuses incomplete or foreign clocked ports before native communications work',async()=>{const{createAgentBusinessTimeContext}=await import('./agent-business-time'),scope={runId:'native-clock-proof',...actor},context=createAgentBusinessTimeContext(scope,{now:()=>Date.now()}),x=fixture();expect(()=>configuredAgentCommunications(actor,x.store as never,{businessTime:{context,scope}})).toThrow('Scoped native communications ports unavailable');expect(()=>configuredAgentCommunications({...actor,userId:'other'},x.store as never,{businessTime:{context,scope}})).toThrow('Agent business time scope unavailable');expect(f.query).not.toHaveBeenCalled();});
it('waits before native begin on Sunday using current routed policy and an exact no-effect proof',async()=>{
 const clock=vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-18T10:00:00.000Z'));
 try{const x=fixture();Object.assign(x.row,{id:conversation});const route={id:'route',conversationId:conversation,channel:'email',bindingId:binding.id,bindingDigest:recordedAgentBindingDigest(binding),recipient:{kind:'email',value:x.row.recipient_email}},store={...x.store,channelPolicy:vi.fn(async()=>({policy:{acceleratedSimulation:false}})),channelDispatchRecord:vi.fn(async()=>({conversation:x.row,operation:{input:{routeId:'route'}},route,submitted:false,notSubmitted:false})),beginNativeCommunicationsMessage:vi.fn(async()=>{throw Error('Current native channel authority or policy unavailable');})};
 await expect(configuredAgentCommunications(actor,store as never).dispatch('thread',conversation,operation)).rejects.toMatchObject({name:'AgentPreBeginSendWindowError',threadId:'thread',conversationId:conversation,operationId:operation,wakeAt:'2026-10-18T22:00:00.000Z'});
 expect(store.preBeginHistoryRetryProof).toHaveBeenCalledWith('thread',operation,conversation);expect(store.beginNativeCommunicationsMessage).not.toHaveBeenCalled();expect(f.dispatch).not.toHaveBeenCalled();
 }finally{clock.mockRestore();}
});
function windowStore(){const x=fixture();Object.assign(x.row,{id:conversation});const route={id:'route',conversationId:conversation,channel:'email',bindingId:binding.id,bindingDigest:recordedAgentBindingDigest(binding),recipient:{kind:'email',value:x.row.recipient_email}};return {...x.store,channelPolicy:vi.fn(async()=>({policy:{acceleratedSimulation:false}})),channelDispatchRecord:vi.fn(async()=>({conversation:x.row,operation:{input:{routeId:'route'}},route,submitted:false,notSubmitted:false})),beginNativeCommunicationsMessage:vi.fn(async()=>{throw Error('Final admission sentinel');})};}
it('skips only the preliminary business-hours wait when the exact local test route has a database exemption',async()=>{
 const clock=vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-18T10:00:00Z'));
 try{const store={...windowStore(),testingSendWindowExempt:vi.fn(async()=>true)};
  await expect(configuredAgentCommunications(actor,store as never).dispatch('thread',conversation,operation)).rejects.toThrow('Final admission sentinel');
  expect(store.testingSendWindowExempt).toHaveBeenCalledExactlyOnceWith('thread','route');
  expect(store.beginNativeCommunicationsMessage).toHaveBeenCalledOnce();expect(f.dispatch).not.toHaveBeenCalled();
 }finally{clock.mockRestore();}
});
it('keeps normal hours for a refused exemption and never sends when its proof fails',async()=>{
 const clock=vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-18T10:00:00Z'));
 try{for(const value of [false,'true',undefined]){const store={...windowStore(),testingSendWindowExempt:vi.fn(async()=>value)};
  await expect(configuredAgentCommunications(actor,store as never).dispatch('thread',conversation,operation)).rejects.toMatchObject({name:'AgentPreBeginSendWindowError'});
  expect(store.beginNativeCommunicationsMessage).not.toHaveBeenCalled();}
  const cause=Error('Database proof unavailable'),store={...windowStore(),testingSendWindowExempt:vi.fn(async()=>{throw cause;})};
  await expect(configuredAgentCommunications(actor,store as never).dispatch('thread',conversation,operation)).rejects.toBe(cause);expect(store.beginNativeCommunicationsMessage).not.toHaveBeenCalled();
 }finally{clock.mockRestore();}
});
it('never consults the local timing exception before recovery and history or when ordinary timing does not require it',async()=>{
 const clock=vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-18T10:00:00Z'));
 try{for(const mode of ['original','history','no-proof','accelerated','open'] as const){
  clock.mockReturnValue(Date.parse(mode==='open'?'2026-10-19T00:00:00Z':'2026-10-18T10:00:00Z'));
  const store={...windowStore(),testingSendWindowExempt:vi.fn(async()=>true)};
  if(mode==='original')f.recover.mockResolvedValueOnce({found:true,outcome:{status:'unknown'}});
  if(mode==='history')f.read.mockResolvedValueOnce({complete:false,messages:[]});
  if(mode==='no-proof')store.preBeginHistoryRetryProof.mockResolvedValueOnce(false);
  if(mode==='accelerated')store.channelPolicy.mockResolvedValueOnce({policy:{acceleratedSimulation:true}});
  const work=configuredAgentCommunications(actor,store as never).dispatch('thread',conversation,operation);
  if(mode==='original')await expect(work).resolves.toEqual({status:'unknown'});else await expect(work).rejects.toThrow();
  expect(store.testingSendWindowExempt).not.toHaveBeenCalled();
 }}finally{clock.mockRestore();}
});
it('does not turn unavailable/no-effect proof, accelerated policy or original recovery into a sending-window wait',async()=>{const clock=vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-18T10:00:00Z'));try{for(const mode of['no-proof','missing-proof','accelerated','original']as const){const store=windowStore();if(mode==='no-proof')store.preBeginHistoryRetryProof.mockResolvedValue(false);if(mode==='missing-proof')delete (store as Partial<typeof store>).preBeginHistoryRetryProof;if(mode==='accelerated')store.channelPolicy.mockResolvedValue({policy:{acceleratedSimulation:true}});if(mode==='original'){f.recover.mockResolvedValueOnce({found:true,outcome:{status:'unknown'}});expect(await configuredAgentCommunications(actor,store as never).dispatch('thread',conversation,operation)).toEqual({status:'unknown'});expect(store.channelPolicy).not.toHaveBeenCalled();}else await expect(configuredAgentCommunications(actor,store as never).dispatch('thread',conversation,operation)).rejects.toThrow('Final admission sentinel');}}finally{clock.mockRestore();}});
it('keeps a selected business sending window at its actual calendar instant',async()=>{const{createAgentBusinessTimeContext}=await import('./agent-business-time'),scope={runId:'native-clock-proof',...actor},context=createAgentBusinessTimeContext(scope,{now:()=>Date.parse('2030-01-06T10:00:00.000Z')}),clock=vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-19T10:00:00.000Z'));try{const store=windowStore();f.query.mockImplementation(async(sql:string)=>sql.includes('AS coherent')?{rows:[{coherent:true}]}:{rows:[binding]});const service=configuredAgentCommunications(actor,store as never,{businessTime:{context,scope},host:{admission:f.admission,readAgentConversation:f.read}as never,actorClient:vi.fn(async()=>({connectionStatus:f.status}))as never,applicationPool:{connect:vi.fn()}as never,applicationCodec:{}as never});await expect(service.dispatch('thread',conversation,operation)).rejects.toMatchObject({name:'AgentPreBeginSendWindowError',wakeAt:'2030-01-06T22:00:00.000Z',businessContext:context});expect(store.beginNativeCommunicationsMessage).not.toHaveBeenCalled();}finally{clock.mockRestore();}});

it('selects the provider-free hosted native facade only for the exact private original binding without constructing a shared service database runtime',async()=>{
 const runId='hosted-demo-example',descriptor={version:1,mode:'hosted-demo',phase:'active',runId,integrationId:'sim-'+runId,configurationReference:'sim-'+runId+'-v1',applicationOrigin:'https://acquire.example.invalid',serviceOrigin:'https://simulator.example.invalid',setupOrigin:'https://simulator.example.invalid',actor:{applicationId:'acquire',tenantId:actor.organizationId,ownerId:actor.userId},capabilities:{dynamicRecipients:true,recipientContextLookup:true,remoteApplicationAuthority:true,durableEvents:true},bindings:[{applicationId:binding.application_id,tenantId:binding.organization_id,ownerId:binding.owner_user_id,connectionId:binding.service_connection_id,accountId:binding.service_account_id,generation:binding.generation,channel:binding.channel,platform:binding.platform,backend:binding.backend}]};
 for(const[k,v]of Object.entries({NODE_ENV:'production',APP_URL:descriptor.applicationOrigin,AGENT_HOSTED_DEMO_COMMUNICATIONS_ENABLED:'true',AGENT_HOSTED_DEMO_COMMUNICATIONS_DESCRIPTOR_JSON:JSON.stringify(descriptor)}))vi.stubEnv(k,v);
 const x=fixture();await x.service.refresh('thread',conversation);expect(f.hosted).toHaveBeenCalledOnce();expect(f.localConfig).not.toHaveBeenCalled();expect(f.read).toHaveBeenCalledOnce();expect(f.admission).toHaveBeenCalledOnce();
 vi.stubEnv('AGENT_HOSTED_DEMO_COMMUNICATIONS_DESCRIPTOR_JSON',JSON.stringify({...descriptor,bindings:[{...descriptor.bindings[0],generation:2}]}));await expect(x.service.refresh('thread',conversation)).rejects.toThrow('Original hosted account changed');expect(f.localConfig).not.toHaveBeenCalled();
});

it.each(['email','whatsapp','linkedin']as const)('uses the invocation-local %s account snapshot without duplicate conversation/binding transactions',async channel=>{
 const x=recordedDispatchFixture(channel),route=x.routes[0],original={...binding,id:route.bindingId,channel,platform:channel==='email'?'gmail':channel};
 const prior=await x.store.channelDispatchRecord();x.store.channelDispatchRecord.mockResolvedValue(Object.assign(prior,{originalAccount:original}));
 await x.service.dispatch('thread',conversation,operation);
 expect(x.store.channelDispatchRecord).toHaveBeenLastCalledWith('thread',operation,{includeOriginalAccount:true});expect(x.store.conversation).not.toHaveBeenCalled();expect(f.query.mock.calls.some(([sql])=>sql.includes('FROM public.communication_bindings'))).toBe(false);
 expect(x.store.channelRoutes).toHaveBeenCalledOnce();expect(f.read).toHaveBeenCalledOnce();expect(f.catchup).toHaveBeenCalledOnce();expect(x.store.beginNativeCommunicationsMessage).toHaveBeenCalledOnce();expect(f.query.mock.calls.some(([sql])=>sql.includes('agent_channel_communications_source'))).toBe(true);expect(f.dispatch).toHaveBeenCalledOnce();
});

async function capturedAccountFixture(channel:'email'|'whatsapp'|'linkedin'='email'){
 const x=recordedDispatchFixture(channel),route=x.routes[0],original={...binding,id:route.bindingId,channel,platform:channel==='email'?'gmail':channel},record=Object.assign(await x.store.channelDispatchRecord(),{originalAccount:original});x.store.channelDispatchRecord.mockResolvedValue(record);x.store.channelDispatchRecord.mockClear();return{...x,record};
}
it('reads a new original account on each invocation and refuses a changed generation rather than reusing the first capture',async()=>{
 const x=await capturedAccountFixture();await x.service.dispatch('thread',conversation,operation);x.record.originalAccount={...x.record.originalAccount,generation:2};
 await expect(x.service.dispatch('thread',conversation,operation)).rejects.toThrow('Original native account changed');expect(x.store.channelDispatchRecord).toHaveBeenCalledTimes(2);expect(f.status).toHaveBeenCalledOnce();expect(f.dispatch).toHaveBeenCalledOnce();
});
it('does not fall back after a captured account is foreign or absent',async()=>{
 for(const patch of [{owner_user_id:'foreign'},null]){const x=await capturedAccountFixture();Object.assign(x.record,{originalAccount:patch===null?null:{...x.record.originalAccount,...patch}});f.status.mockClear();await expect(x.service.dispatch('thread',conversation,operation)).rejects.toThrow('Original native account changed');expect(x.store.conversation).not.toHaveBeenCalled();expect(f.status).not.toHaveBeenCalled();}
});
it('retains final source/CAS refusal after the invocation-local account capture without dispatching or retrying',async()=>{
 const x=await capturedAccountFixture('whatsapp'),prior=f.query.getMockImplementation()!,cause=Error('Current reviewed source changed');f.query.mockImplementation(async(sql,...args)=>{if(sql.includes('agent_channel_communications_source'))throw cause;return prior(sql,...args);});
 await expect(x.service.dispatch('thread',conversation,operation)).rejects.toBe(cause);expect(x.store.channelRoutes).toHaveBeenCalledOnce();expect(f.catchup).toHaveBeenCalledOnce();expect(x.store.beginNativeCommunicationsMessage).toHaveBeenCalledOnce();expect(f.dispatch).not.toHaveBeenCalled();
});
it('rereads current route identity after receipt recovery even when original metadata was captured together',async()=>{
 const x=await capturedAccountFixture('linkedin');f.recover.mockImplementationOnce(async()=>{x.routes[0]={...x.routes[0],bindingDigest:'b'.repeat(64)};return{found:false};});
 await expect(x.service.dispatch('thread',conversation,operation)).rejects.toThrow('before outbound admission');expect(x.store.channelRoutes).toHaveBeenCalledOnce();expect(f.read).not.toHaveBeenCalled();expect(x.store.beginNativeCommunicationsMessage).not.toHaveBeenCalled();expect(f.dispatch).not.toHaveBeenCalled();
});

it('stops an expired history refresh before account or provider work',async()=>{const x=fixture(),controller=new AbortController();controller.abort();await expect(x.service.refresh('thread',conversation,controller.signal)).rejects.toThrow();expect(x.store.conversation).not.toHaveBeenCalled();expect(f.status).not.toHaveBeenCalled();});
it('does not start another stage after cancellation during account status',async()=>{const x=fixture(),controller=new AbortController();f.status.mockImplementationOnce(async()=>{controller.abort();return{status:'connected'};});await expect(x.service.refresh('thread',conversation,controller.signal)).rejects.toThrow();expect(f.admission).not.toHaveBeenCalled();expect(f.saveIdentity).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();});
it('does not ingest a history response that completes after cancellation',async()=>{const x=fixture(),controller=new AbortController();f.read.mockImplementationOnce(async()=>{controller.abort();return{source:'communications',complete:true,messages:[]};});await expect(x.service.refresh('thread',conversation,controller.signal)).rejects.toThrow();expect(x.store.ingestHistory).not.toHaveBeenCalled();});
it('passes the worker cancellation signal into the history transport',async()=>{const x=fixture(),controller=new AbortController();await x.service.refresh('thread',conversation,controller.signal);expect(f.read).toHaveBeenCalledWith(expect.any(Object),'person@example.invalid',controller.signal);});

it('uses one owned account snapshot per refresh without calculating conversation revisions for each channel',async()=>{
 const x=fixture(),route={id:'50000000-0000-4000-8000-000000000001',conversationId:conversation,channel:'email',bindingId:binding.id,bindingDigest:recordedAgentBindingDigest(binding),recipient:{kind:'email',value:'person@example.invalid'}};
 const historyAccountSnapshot=vi.fn(async()=>({conversation:x.row,accounts:[binding]}));
 const store={...x.store,historyAccountSnapshot,channelRoutes:vi.fn(async()=>[route]),ingestChannelHistory:vi.fn()};
 f.read.mockImplementation(async(selected)=>({binding:selected,source:'communications',complete:true,observedAt:'2026-10-17T00:00:00.000Z',messages:[],scopeDigest:'a'.repeat(64)}));
 const service=configuredAgentCommunications(actor,store as never);
 await service.refresh('thread',conversation);
 expect(historyAccountSnapshot).toHaveBeenCalledOnce();expect(x.store.conversation).not.toHaveBeenCalled();expect(f.query).not.toHaveBeenCalled();
 await service.refresh('thread',conversation);expect(historyAccountSnapshot).toHaveBeenCalledTimes(2);
 historyAccountSnapshot.mockResolvedValueOnce({conversation:x.row,accounts:[{...binding,generation:2}]});
 await expect(service.refresh('thread',conversation)).rejects.toThrow('Original native account changed');
});

it('checkpoints background history one channel at a time and requires observations newer than the event',async()=>{
 const x=fixture(),since=new Date(Date.now()-10000).toISOString();
 const accounts=['email','whatsapp','linkedin'].map((channel,i)=>({...binding,id:`40000000-0000-4000-8000-00000000000${i+1}`,channel,platform:channel==='email'?'gmail':channel,service_connection_id:'connection-'+channel,service_account_id:'account-'+channel}));
 const routes=accounts.map((b,i)=>({id:`50000000-0000-4000-8000-00000000000${i+1}`,conversationId:conversation,channel:b.channel,bindingId:b.id,bindingDigest:recordedAgentBindingDigest(b),recipient:{kind:b.channel==='email'?'email':b.channel==='whatsapp'?'phone':'linkedin_profile',value:b.channel==='email'?'person@example.invalid':b.channel==='whatsapp'?'+61400000002':'https://www.linkedin.com/in/peer'},historyComplete:false,historyObservedAt:null as string|null}));
 const store={...x.store,historyAccountSnapshot:vi.fn(async()=>({conversation:x.row,accounts})),channelRoutes:vi.fn(async()=>structuredClone(routes)),ingestChannelHistory:vi.fn(async(_t:string,_c:string,id:string)=>{const route=routes.find(r=>r.id===id)!;route.historyComplete=true;route.historyObservedAt=new Date().toISOString();})};
 f.read.mockImplementation(async(selected)=>({binding:selected,source:'communications',complete:true,observedAt:new Date().toISOString(),messages:[],scopeDigest:'a'.repeat(64)}));
 const service=configuredAgentCommunications(actor,store as never);
 for(let i=0;i<3;i++){await expect(service.refreshCheckpoint('thread',conversation,since)).rejects.toMatchObject({name:'AgentHistoryCheckpointPendingError'});expect(f.read).toHaveBeenCalledTimes(i+1);}
 await service.refreshCheckpoint('thread',conversation,since);expect(f.read).toHaveBeenCalledTimes(3);expect(f.catchup).not.toHaveBeenCalled();expect(f.dispatch).not.toHaveBeenCalled();
 routes[0].historyObservedAt=new Date(Date.parse(since)-1).toISOString();await expect(service.refreshCheckpoint('thread',conversation,since)).rejects.toMatchObject({name:'AgentHistoryCheckpointPendingError'});expect(f.read).toHaveBeenCalledTimes(4);
});
