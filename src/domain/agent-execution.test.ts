import {expect,it} from 'vitest';
import {nativeEmailDraftSchema,nativeHistorySchema,nativeReminderSchema,explicitAgentOptOut} from './agent-execution';
const draft={kind:'reply_email',intent:'question',subject:'Re: enquiry',body:'The buyer is a privately owned Australian group.',rationale:'Answer using the approved buyer profile.',sourceIds:['buyer-profile']};
it('accepts a grounded reply proposal without exposing recipient, tenant or authority controls',()=>{
 expect(nativeEmailDraftSchema.parse(draft)).toMatchObject({kind:'reply_email'});
 for(const fields of [{recipient:'someone@else.invalid'},{grant:'yolo'},{organizationId:'other'},{bookingLink:'https://example.invalid/book'}])expect(nativeEmailDraftSchema.safeParse({...draft,...fields}).success).toBe(false);
});
it('keeps booking links out of autonomous email content',()=>{
 for(const body of ['Book at https://example.invalid/book','Use calendly.com/owner','Visit booking.example.com/owner'])expect(nativeEmailDraftSchema.safeParse({...draft,body}).success).toBe(false);
});
it('detects explicit opt-outs from untrusted lead text before requesting another reply',()=>{
 for(const text of ['Please unsubscribe me.','Do not contact me again','Remove me from this list'])expect(explicitAgentOptOut(text)).toBe(true);
 expect(explicitAgentOptOut('Who is the proposed buyer?')).toBe(false);
});
it('bounds and deduplicates the history snapshot and keeps its provenance explicit',()=>{
 const message={id:'lead-message',direction:'inbound',text:'Can we arrange a call?',at:'2026-10-17T10:00:00Z'};
 const history={source:'local_fixture',observedAt:'2026-10-17T10:01:00Z',complete:true,messages:[message]};
 expect(nativeHistorySchema.safeParse(history).success).toBe(true);expect(nativeHistorySchema.safeParse({...history,messages:[message,message]}).success).toBe(false);
});
it('requires an absolute wake-up, a valid timezone and an explainable reason',()=>{
 expect(nativeReminderSchema.safeParse({wakeAt:'2026-10-20T10:00:00Z',timeZone:'Australia/Melbourne',reason:'They asked us to follow up next week.'}).success).toBe(true);
 expect(nativeReminderSchema.safeParse({wakeAt:'Tuesday',timeZone:'Australia/Melbourne',reason:'Follow up'}).success).toBe(false);
 expect(nativeReminderSchema.safeParse({wakeAt:'2026-10-20T10:00:00Z',timeZone:'Unknown/Zone',reason:'Follow up'}).success).toBe(false);
});

it('does not bypass the human booking boundary by putting a link in the subject',()=>{
 expect(nativeEmailDraftSchema.safeParse({...draft,subject:'Book https://example.invalid/call'}).success).toBe(false);
});
