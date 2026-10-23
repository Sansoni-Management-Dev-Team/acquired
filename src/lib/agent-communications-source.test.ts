import {expect,it,vi} from 'vitest';import {readAgentCommunicationsSource,readAgentChannelCommunicationsSource,readAgentCommunicationsSourceKind} from './agent-communications-source';
const source={kind:'agent',operationId:'10000000-0000-4000-8000-000000000001',conversationId:'10000000-0000-4000-8000-000000000002',epoch:1,fence:'1'};
const proof={contactId:'10000000-0000-4000-8000-000000000003',recipient:'person@example.invalid',subject:'Synthetic',body:'Synthetic body',contextDigest:'a'.repeat(64),requiredSince:'1970-01-01T00:00:00.000000Z',replyParent:null};
it('canonicalizes native PostgreSQL microsecond timestamps before sealing an intent',async()=>{
 const client={query:vi.fn().mockResolvedValue({rows:[{source:proof}]})};const value=await readAgentCommunicationsSource(client,source,'10000000-0000-4000-8000-000000000004');
 expect(value.requiredSince).toBe('1970-01-01T00:00:00.000Z');expect(value).toEqual({...proof,requiredSince:'1970-01-01T00:00:00.000Z'});
});
it('keeps invalid or absent native authority rejected before normalization',async()=>{
 for(const value of [null,{...proof,requiredSince:'not-a-date'},{...proof,requiredSince:'2026-15-01T00:00:00Z'}])await expect(readAgentCommunicationsSource({query:vi.fn().mockResolvedValue({rows:[{source:value}]})},source,'10000000-0000-4000-8000-000000000004')).rejects.toThrow();
});
it('retains exact canonical social recipients and actual provider reply parents while normalizing only coverage time',async()=>{
 const routed={...proof,channel:'whatsapp',routeId:source.conversationId,recipient:{kind:'phone',value:'+61412345678'},subject:'',replyParent:null,conversation:{id:'provider-chat-original'},coverageRoutes:[{bindingId:source.operationId,channel:'whatsapp',recipient:{kind:'phone',value:'+61412345678'}}]};
 const client={query:vi.fn().mockResolvedValue({rows:[{source:routed}]})};
 expect(await readAgentChannelCommunicationsSource(client,source,source.operationId)).toEqual({...routed,requiredSince:'1970-01-01T00:00:00.000Z'});
 for(const changed of [{channel:'linkedin'},{subject:'invented social subject'},{replyParent:{id:'provider-message-original',contentDigest:'b'.repeat(64)}},{recipient:{kind:'phone',value:'0412345678'}},{routeId:undefined},{conversation:{id:''}},{coverageRoutes:[]},{coverageRoutes:[...routed.coverageRoutes,...routed.coverageRoutes]},{coverageRoutes:[{...routed.coverageRoutes[0],bindingId:source.conversationId}]}])await expect(readAgentChannelCommunicationsSource({query:vi.fn().mockResolvedValue({rows:[{source:{...routed,...changed}}]})},source,source.operationId)).rejects.toThrow();
});
it('chooses source kind only from held owned SQL proof and rejects unknown values instead of falling back',async()=>{
 expect(await readAgentCommunicationsSourceKind({query:vi.fn().mockResolvedValue({rows:[{kind:'recorded_channel'}]})},source,source.operationId)).toBe('recorded_channel');
 await expect(readAgentCommunicationsSourceKind({query:vi.fn().mockResolvedValue({rows:[{kind:null}]})},source,source.operationId)).rejects.toThrow();
});
it('requires matching trusted invitation effect, exact LinkedIn route, bounded note and no conversation/parent',async()=>{
 const recipient={kind:'linkedin_profile',value:'https://www.linkedin.com/in/simulated-peer'},routed={...proof,effect:'invitation',channel:'linkedin',routeId:source.conversationId,recipient,subject:'',body:'A reviewed invitation',replyParent:null,conversation:null,coverageRoutes:[{bindingId:source.operationId,channel:'linkedin',recipient}]},invite={...source,effect:'invitation'};
 const read=(raw:unknown,value:unknown)=>readAgentChannelCommunicationsSource({query:vi.fn().mockResolvedValue({rows:[{source:value}]})},raw,source.operationId);
 expect(await read(invite,routed)).toMatchObject({effect:'invitation'});
 for(const[raw,value]of [[source,routed],[invite,{...routed,effect:undefined}],[invite,{...routed,body:'x'.repeat(301)}],[invite,{...routed,conversation:{id:'chat'}}],[invite,{...routed,channel:'whatsapp',recipient:{kind:'phone',value:'+9990000000001'}}]])await expect(read(raw,value)).rejects.toThrow();
 await expect(readAgentCommunicationsSource({query:vi.fn().mockResolvedValue({rows:[{source:proof}]})},invite,source.operationId)).rejects.toThrow();
});
