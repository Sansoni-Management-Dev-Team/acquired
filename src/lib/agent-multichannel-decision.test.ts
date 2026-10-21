import {expect,it,vi} from 'vitest';
import {reassessAgentConversation,type AgentConversationContext} from './agent-conversation-engine';

const conversationId='10000000-0000-4000-8000-000000000001';
const whatsappRoute='20000000-0000-4000-8000-000000000002';
const linkedinRoute='30000000-0000-4000-8000-000000000003';
const at='2026-10-17T08:01:00Z';
const base:AgentConversationContext={conversationId,epoch:1,reminderGeneration:1,revision:1,contextRevision:'a'.repeat(64),phase:'active',driver:'agent',supervisionActive:true,deliveryMode:'communications',historyComplete:true,historyObservedAt:at,goal:'Explore commercial refrigeration acquisitions; human sends any booking link',history:[],sources:[{id:'approved-buyer',text:'Australian search partnership; no verified funding.'}],guidance:[]};
const route=(id:string,channel:'whatsapp'|'linkedin')=>({id,channel,historyComplete:true,historyObservedAt:at,readiness:'ready' as const,nextAllowedAt:null});
const draft=(kind:string,routeId:string)=>({kind,routeId,intent:kind.startsWith('initial')?'initial':'question',subject:'',body:'Would a brief introduction be useful?',rationale:'Use the selected recorded channel.',sourceIds:['approved-buyer']});
function port(context:unknown,decision:unknown){return {load:vi.fn().mockResolvedValue(context),decide:vi.fn().mockResolvedValue(decision),commit:vi.fn().mockResolvedValue({status:'proposed'}),now:()=>at};}
const trigger={conversationId,epoch:1,reminderGeneration:1,requestKey:'trusted-event'};

it('allows reviewed WhatsApp and LinkedIn proposals through their exact recorded routes',async()=>{
 for(const [channel,id] of [['whatsapp',whatsappRoute],['linkedin',linkedinRoute]] as const){
  const p=port({...base,channels:[route(id,channel)]},{action:'draft',draft:draft('initial_'+channel,id)});
  await reassessAgentConversation(p,trigger);
  expect(p.commit).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({action:'draft',draft:expect.objectContaining({kind:'initial_'+channel,routeId:id})}),trigger.requestKey);
 }
});

it('rejects unknown, mismatched, incomplete and not-yet-due routes without creating an outbound proposal',async()=>{
 for(const channels of [[route(linkedinRoute,'linkedin')],[route(whatsappRoute,'linkedin')],[{...route(whatsappRoute,'whatsapp'),historyComplete:false}],[{...route(whatsappRoute,'whatsapp'),readiness:'review'}],[{...route(whatsappRoute,'whatsapp'),nextAllowedAt:'2026-10-18T08:00:00Z'}]]){
  const p=port({...base,channels},{action:'draft',draft:draft('initial_whatsapp',whatsappRoute)});
  await expect(reassessAgentConversation(p,trigger)).rejects.toThrow();expect(p.commit).not.toHaveBeenCalled();
 }
});

it('prevents another cold channel introduction after the person has replied on any channel',async()=>{
 const p=port({...base,channels:[route(whatsappRoute,'whatsapp'),route(linkedinRoute,'linkedin')],history:[{id:'verified-whatsapp-reply',direction:'inbound',text:'Who are you?',at:'2026-10-17T08:00:00Z',channel:'whatsapp',routeId:whatsappRoute}]},{action:'draft',draft:draft('initial_linkedin',linkedinRoute)});
 await expect(reassessAgentConversation(p,trigger)).rejects.toThrow(/cold|initial|replied/i);expect(p.commit).not.toHaveBeenCalled();
});

it('turns a model duplicate answer into a durable wait while preserving its recorded model decision',async()=>{
 const context={...base,history:[{id:'lead-question',direction:'inbound',text:'Who is buying?',at:'2026-10-17T07:59:00Z'},{id:'confirmed-answer',direction:'outbound',text:'We are an Australian search partnership.',at:'2026-10-17T08:00:00Z'}]};
 const p=port(context,{action:'draft',draft:{kind:'reply_email',intent:'question',subject:'Re: introduction',body:'We are an Australian search partnership.',rationale:'Answer the old question again',sourceIds:['lead-question']}});
 await reassessAgentConversation(p,trigger);
 expect(p.commit).toHaveBeenCalledOnce();expect(p.commit).toHaveBeenCalledWith(context,expect.objectContaining({action:'wait',reminder:expect.objectContaining({wakeAt:'2026-10-18T08:01:00.000Z'})}),trigger.requestKey+':await-reply');
});

it('permits answering a genuinely newer incoming message on its recorded channel',async()=>{
 const context={...base,channels:[route(whatsappRoute,'whatsapp')],history:[{id:'old-answer',direction:'outbound',text:'A search partnership.',at:'2026-10-17T07:58:00Z',routeId:whatsappRoute,channel:'whatsapp'},{id:'new-question',direction:'inbound',text:'Can a human explain the background?',at:'2026-10-17T08:00:00Z',routeId:whatsappRoute,channel:'whatsapp'}]};
 const p=port(context,{action:'draft',draft:draft('reply_whatsapp',whatsappRoute)});await reassessAgentConversation(p,trigger);expect(p.commit).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({action:'draft'}),trigger.requestKey);
});

it('does not silently move a reply to a different channel or accept model-selected account fields',async()=>{
 const context={...base,channels:[route(whatsappRoute,'whatsapp'),route(linkedinRoute,'linkedin')],history:[{id:'new-question',direction:'inbound',text:'Who is buying?',at:'2026-10-17T08:00:00Z',routeId:whatsappRoute,channel:'whatsapp'}]};
 for(const value of [draft('reply_linkedin',linkedinRoute),{...draft('reply_whatsapp',whatsappRoute),accountId:'model-selected-account'}]){
  const p=port(context,{action:'draft',draft:value});await expect(reassessAgentConversation(p,trigger)).rejects.toThrow();expect(p.commit).not.toHaveBeenCalled();
 }
});

it('does not disguise a cross-channel cold follow-up as a response after this person has replied',async()=>{
 const context={...base,channels:[route(whatsappRoute,'whatsapp'),route(linkedinRoute,'linkedin')],history:[{id:'old-linkedin-outbound',direction:'outbound',text:'Our first introduction',at:'2026-10-16T08:00:00Z',routeId:linkedinRoute,channel:'linkedin'},{id:'new-whatsapp-question',direction:'inbound',text:'Who is buying?',at:'2026-10-17T08:00:00Z',routeId:whatsappRoute,channel:'whatsapp'}]};
 const p=port(context,{action:'draft',draft:draft('follow_up_linkedin',linkedinRoute)});
 await expect(reassessAgentConversation(p,trigger)).rejects.toThrow(/channel|reply|inbound/);expect(p.commit).not.toHaveBeenCalled();
});

it.each([false,true])('allows either newest tied verified inbound route regardless of input order (reverse=%s)',async reverse=>{
 const emailRoute='40000000-0000-4000-8000-000000000004',same='2026-10-17T08:00:00Z',history=[{id:'z-whatsapp',direction:'inbound',text:'Please use email.',at:same,channel:'whatsapp',routeId:whatsappRoute},{id:'a-email',direction:'inbound',text:'Who is buying?',at:same,channel:'email',routeId:emailRoute}];
 if(reverse)history.reverse();
 for(const [channel,id]of[['email',emailRoute],['whatsapp',whatsappRoute]]as const){const p=port({...base,history,channels:[{...route(whatsappRoute,'whatsapp'),allowedActions:['reply']},{...route(emailRoute,'whatsapp'),channel:'email',allowedActions:['reply']}]},{action:'draft',draft:{...draft('reply_'+channel,id),subject:channel==='email'?'Re: introduction':''}});await reassessAgentConversation(p,trigger);expect(p.commit).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({action:'draft'}),trigger.requestKey);}
});
it('rejects an earlier selected-route inbound when another route is genuinely newer',async()=>{
 const p=port({...base,channels:[route(whatsappRoute,'whatsapp'),route(linkedinRoute,'linkedin')],history:[{id:'old',direction:'inbound',text:'Old question',at:'2026-10-17T07:59:00Z',routeId:whatsappRoute,channel:'whatsapp'},{id:'new',direction:'inbound',text:'New question',at:'2026-10-17T08:00:00Z',routeId:linkedinRoute,channel:'linkedin'}]},{action:'draft',draft:draft('reply_whatsapp',whatsappRoute)});await expect(reassessAgentConversation(p,trigger)).rejects.toThrow(/latest|newest/);expect(p.commit).not.toHaveBeenCalled();
});
it('does not propose a second tied reply after a verified outbound on either route',async()=>{
 const same='2026-10-17T08:00:00Z',history=[{id:'z-wa',direction:'inbound',text:'Question',at:same,routeId:whatsappRoute,channel:'whatsapp'},{id:'a-li',direction:'inbound',text:'Question',at:same,routeId:linkedinRoute,channel:'linkedin'},{id:'answer',direction:'outbound',text:'Answered',at:same,routeId:linkedinRoute,channel:'linkedin'}];
 const p=port({...base,channels:[route(whatsappRoute,'whatsapp'),route(linkedinRoute,'linkedin')],history},{action:'draft',draft:draft('reply_whatsapp',whatsappRoute)});await reassessAgentConversation(p,trigger);expect(p.commit).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({action:'wait'}),trigger.requestKey+':await-reply');
});
