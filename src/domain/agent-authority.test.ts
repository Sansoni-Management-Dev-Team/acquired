import {expect,it} from 'vitest';
import {assertExactReviewBatch,admitAgentAuthority,authorityGrantSchema} from './agent-authority';
const item={operationId:'00000000-0000-4000-8000-000000000001',revision:1,digest:'a'.repeat(64),contextRevision:'context-1'};
const scope={organizationId:'org',mandateId:'mandate',userId:'user',threadId:'thread'};
const action={...scope,kind:'reply_email' as const,recipientKey:'email:owner@example.invalid',bindingDigest:'b'.repeat(64),contextRevision:'context-1',operationId:item.operationId,revision:1,digest:item.digest};
const context={now:'2026-10-17T10:00:00Z',owner:'agent' as const,suppressed:false,humanTakeover:false,historyComplete:true,currentContextRevision:'context-1'};
const approval={...scope,items:[item]};
const grant={...scope,id:'grant',revision:1,channel:'email',actions:['reply_email'],recipientKeys:[action.recipientKey],bindingDigest:action.bindingDigest,maxSends:3,usedSends:0,approvedBy:'user',approvedAt:'2026-10-17T09:00:00Z',expiresAt:'2026-10-18T09:00:00Z'};
it('requires human approval by default',()=>{expect(()=>admitAgentAuthority(action,context,{})).toThrow('approval');});
it('approves only the exact displayed batch, independent of item ordering',()=>{
 const second={...item,operationId:'00000000-0000-4000-8000-000000000002'};
 expect(()=>assertExactReviewBatch([item,second],[second,item])).not.toThrow();
 for(const changed of [[item],[item,second,{...second,revision:2}],[{...item,revision:2},second],[{...item,contextRevision:'changed'},second]])expect(()=>assertExactReviewBatch([item,second],changed)).toThrow();
 expect(()=>assertExactReviewBatch([item,item],[item,item])).toThrow();
});
it('uses exact reviewed content without approving a later edit or context',()=>{
 expect(admitAgentAuthority(action,context,{approval})).toEqual({mode:'reviewed'});
 for(const changed of [{revision:2},{digest:'c'.repeat(64)},{contextRevision:'changed'},{operationId:'another'}])expect(()=>admitAgentAuthority({...action,...changed},context,{approval})).toThrow();
});
it('allows a bounded scoped grant, with current grant revision recorded',()=>{
 expect(admitAgentAuthority(action,context,{grant})).toEqual({mode:'delegated',grantId:'grant',grantRevision:1});
});
it('rejects exhausted, expired, revoked, foreign and wrong-binding delegation',()=>{
 for(const changed of [{usedSends:3},{expiresAt:context.now},{revokedAt:context.now},{organizationId:'foreign'},{mandateId:'foreign'},{userId:'other'},{threadId:'other'},{bindingDigest:'c'.repeat(64)},{recipientKeys:['other']},{actions:['initial_email']}])expect(()=>admitAgentAuthority(action,context,{grant:{...grant,...changed}})).toThrow();
});
it('never delegates the human booking-link handoff or memory approval',()=>{
 for(const kind of ['booking_link','approve_memory','handoff'])expect(()=>admitAgentAuthority({...action,kind} as never,context,{grant})).toThrow();
});
it('enforces current ownership, context, suppression, takeover and history even after approval',()=>{
 for(const changed of [{owner:'human'},{owner:'sequence'},{currentContextRevision:'context-2'},{suppressed:true},{humanTakeover:true},{historyComplete:false},{now:'invalid'}])expect(()=>admitAgentAuthority(action,{...context,...changed} as never,{approval})).toThrow();
});
it('bounds grants to seven days and forbids wildcard recipients and model self-approval',()=>{
 for(const changed of [{expiresAt:'2026-10-25T09:00:00Z'},{recipientKeys:['*']},{actions:['approve_memory']},{maxSends:0},{approvedBy:''},{approveAll:true}])expect(authorityGrantSchema.safeParse({...grant,...changed}).success).toBe(false);
});
it('binds social delegation to one channel and an explicit route without expanding email grants',()=>{
 const routeId='00000000-0000-4000-8000-000000000003';
 const social={...action,kind:'reply_whatsapp',routeId,recipientKey:'whatsapp:+61412345678'};
 const socialGrant={...grant,channel:'whatsapp',actions:['reply_whatsapp'],routeIds:[routeId],recipientKeys:[social.recipientKey]};
 expect(admitAgentAuthority(social,context,{grant:socialGrant})).toMatchObject({mode:'delegated'});
 for(const changed of [{routeId:'00000000-0000-4000-8000-000000000004'},{kind:'reply_linkedin'},{routeId:undefined}])expect(()=>admitAgentAuthority({...social,...changed},context,{grant:socialGrant})).toThrow();
 expect(()=>admitAgentAuthority(social,context,{grant})).toThrow();
 expect(authorityGrantSchema.safeParse({...socialGrant,actions:['reply_whatsapp','reply_email']}).success).toBe(false);
 expect(authorityGrantSchema.safeParse({...socialGrant,actions:['linkedin_invitation']}).success).toBe(false);
});
