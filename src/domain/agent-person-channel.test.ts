import {expect,it} from 'vitest';
import {agentPersonChannelRecipientSchema,agentChannelRouteInputSchema,agentChannelOperation,agentChannelPolicyInputSchema} from './agent-person-channel';
const conversationId='00000000-0000-4000-8000-000000000001',bindingId='00000000-0000-4000-8000-000000000002';
it('uses exact canonical SDK recipients rather than guessing provider IDs or changing reviewed addresses',()=>{
 for(const value of [{channel:'email',recipient:{kind:'email',value:'owner@example.invalid'}},{channel:'whatsapp',recipient:{kind:'phone',value:'+61412345678'}},{channel:'linkedin',recipient:{kind:'linkedin_profile',value:'https://www.linkedin.com/in/test-owner'}}])expect(agentPersonChannelRecipientSchema.parse(value)).toEqual(value);
 for(const value of [{channel:'email',recipient:{kind:'email',value:'OWNER@example.invalid'}},{channel:'whatsapp',recipient:{kind:'phone',value:'0412345678'}},{channel:'linkedin',recipient:{kind:'linkedin_profile',value:'urn:li:member:123'}},{channel:'linkedin',recipient:{kind:'linkedin_profile',value:'https://www.linkedin.com/in/test-owner?tracking=1'}},{channel:'linkedin',recipient:{kind:'phone',value:'+61412345678'}}])expect(agentPersonChannelRecipientSchema.safeParse(value).success).toBe(false);
});
it('requires exact person context and an explicit owned account per selected channel',()=>{
 const value={conversationId,revision:3,contextRevision:'a'.repeat(64),bindingId,channel:'whatsapp',recipient:{kind:'phone',value:'+61412345678'},identityProof:{kind:'recorded_contact',revision:'12345'}};
 expect(agentChannelRouteInputSchema.parse(value)).toEqual(value);
 for(const change of [{bindingId:undefined},{revision:0},{contextRevision:'old'},{recipient:{kind:'phone',value:'*'}},{identityProof:undefined},{identityProof:{kind:'recorded_contact',revision:'*'}},{identityProof:{kind:'model_claim',revision:'12345'}},{fallbackBindingId:bindingId},{autoResolve:true},{ownerId:'another-person'}])expect(agentChannelRouteInputSchema.safeParse({...value,...change}).success).toBe(false);
});
it('maps only reviewed message stages; connection invitations and booking are never message tools',()=>{
 expect(agentChannelOperation('email','initial')).toBe('email.initial');
 expect(agentChannelOperation('whatsapp','reply')).toBe('whatsapp.reply');
 expect(agentChannelOperation('linkedin','follow_up')).toBe('linkedin.follow_up');
 for(const stage of ['invitation','inmail','booking','*'])expect(()=>agentChannelOperation('linkedin',stage as never)).toThrow();
});
it('reviews a bounded unique channel order and exact accounts without admitting fast production sends',()=>{
 const value={expectedRevision:0,channelOrder:['email','linkedin'],delaySeconds:86400,bindings:[{channel:'email',bindingId},{channel:'linkedin',bindingId:conversationId}]};
 expect(agentChannelPolicyInputSchema.parse(value)).toMatchObject({...value,acceleratedSimulation:false});
 for(const change of [{channelOrder:['email','email']},{delaySeconds:3},{bindings:[{channel:'email',bindingId}]},{bindings:[{channel:'email',bindingId},{channel:'linkedin',bindingId}]},{expectedRevision:-1},{allowAnyAccount:true}])expect(agentChannelPolicyInputSchema.safeParse({...value,...change}).success).toBe(false);
 expect(agentChannelPolicyInputSchema.safeParse({...value,delaySeconds:3,acceleratedSimulation:true}).success).toBe(true);
 expect(agentChannelPolicyInputSchema.safeParse({...value,delaySeconds:2,acceleratedSimulation:true}).success).toBe(false);
});
