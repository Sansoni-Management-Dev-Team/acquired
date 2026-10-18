import{expect,it,vi}from'vitest';
import{reassessAgentConversation}from'./agent-conversation-engine';
const conversationId='10000000-0000-4000-8000-000000000001',routeId='20000000-0000-4000-8000-000000000002',now='2026-10-17T08:00:00Z';
const route={id:routeId,channel:'linkedin',historyComplete:true,historyObservedAt:now,readiness:'ready',nextAllowedAt:null,allowedActions:['invitation'],relationship:{status:'not_connected',canMessage:null,observedAt:now}};
const context={conversationId,epoch:1,reminderGeneration:1,revision:1,contextRevision:'a'.repeat(64),phase:'active',driver:'agent',supervisionActive:true,deliveryMode:'communications',historyComplete:true,historyObservedAt:now,goal:'Explore an acquisition and hand meeting readiness to a human.',history:[],sources:[{id:'buyer-profile',text:'Approved public buyer information'}],guidance:[],channels:[route]};
const draft={kind:'invitation_linkedin',routeId,intent:'initial',subject:'',body:'Hello, I would welcome a connection to introduce our acquisition search.',rationale:'The verified profile is not connected; request a separately reviewed invitation.',sourceIds:['buyer-profile']};
const event={conversationId,epoch:1,reminderGeneration:1,requestKey:'trusted-invitation-event'};
function fixture(changed:unknown=context,value:unknown=draft){return{load:vi.fn().mockResolvedValue(changed),decide:vi.fn().mockResolvedValue({action:'draft',draft:value}),commit:vi.fn(),now:()=>now};}
it('proposes an explicit bounded LinkedIn invitation using fresh not-connected proof and a permitted route',async()=>{const p=fixture();await reassessAgentConversation(p,event);expect(p.commit).toHaveBeenCalledWith(expect.anything(),{action:'draft',draft},event.requestKey);});
it('does not infer invitation permission from a chat reply, pending invitation, unknown or stale relationship',async()=>{
 const changes=[{relationship:{status:'invitation_pending',canMessage:false,observedAt:now}},{relationship:{status:'connected',canMessage:true,observedAt:now}},{relationship:{status:'unknown',canMessage:null,observedAt:now}},{relationship:{status:'not_connected',canMessage:null,observedAt:'2026-10-17T07:00:00Z'}},{allowedActions:['initial']}];
 for(const changed of changes){const p=fixture({...context,channels:[{...route,...changed}]});await expect(reassessAgentConversation(p,event)).rejects.toThrow();expect(p.commit).not.toHaveBeenCalled();}
 const replied=fixture({...context,history:[{id:'verified-email-reply',direction:'inbound',text:'Who are you?',at:'2026-10-17T07:59:00Z'}]});await expect(reassessAgentConversation(replied,event)).rejects.toThrow();expect(replied.commit).not.toHaveBeenCalled();
});
it('does not turn missing connection authority into a direct message or an overlong invitation',async()=>{
 for(const value of [{...draft,kind:'initial_linkedin'}, {...draft,body:'x'.repeat(301)},{...draft,approved:true}]){const p=fixture(context,value);await expect(reassessAgentConversation(p,event)).rejects.toThrow();expect(p.commit).not.toHaveBeenCalled();}
});
