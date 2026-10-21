import { describe, it, expect } from 'vitest';
import { verifyRuntimeSentEmail } from './v1-runtime-email';
import type { ConnectionBinding } from '../../contracts/src';
const binding: ConnectionBinding = { applicationId: 'app', tenantId: 'tenant', ownerId: 'owner', connectionId: 'connection', accountId: 'physical', generation: 1, channel: 'email', platform: 'gmail', backend: 'unipile' };
const evidence = { trackingId: 'tracking', providerAccountId: 'provider', emailId: 'email-id', rfcMessageId: '<real@example.test>', recipient: 'recipient@example.test', occurredAt: '2026-01-01T00:00:00.000Z' };
function fixture() { return { binding, ownerAddresses: ['owner@example.test'], providerAccountId: 'provider', recipient: evidence.recipient, evidence, raw: { object: 'Email', kind: '2_full', type: 'GOOGLE_OAUTH', account_id: 'provider', id: 'email-id', message_id: evidence.rfcMessageId, date: evidence.occurredAt, role: 'sent', thread_id: 'thread', from_attendee: { identifier: 'owner@example.test' }, to_attendees: [{ identifier: evidence.recipient }], cc_attendees: [], bcc_attendees: [], headers: [{ name: 'Message-ID', value: evidence.rfcMessageId }] } }; }
describe('concrete original sent-email verifier', () => {
    it('accepts actual exact full outbound message with distinct RFC ID and real sent time', () => { expect(verifyRuntimeSentEmail(fixture())).toMatchObject({ receipt: { message: { binding, id: 'email-id' }, submittedAt: evidence.occurredAt }, rfcMessageId: evidence.rfcMessageId }); });
    it.each(['wrong account', 'wrong recipient', 'inbound', 'RFC mismatch', 'future date'])('rejects %s without guessing association', kind => { const f = fixture(); if (kind === 'wrong account')
        f.raw.account_id = 'another'; if (kind === 'wrong recipient')
        f.raw.to_attendees[0].identifier = 'another@example.test'; if (kind === 'inbound')
        f.raw.role = 'inbox'; if (kind === 'RFC mismatch')
        f.raw.headers[0].value = '<other@example.test>'; if (kind === 'future date')
        f.raw.date = new Date(Date.now() + 60000).toISOString(); expect(verifyRuntimeSentEmail(f)).toBeNull(); });
    it('requires original thread agreement', () => { expect(verifyRuntimeSentEmail({ ...fixture(), conversationId: 'different-thread' })).toBeNull(); });
});

it('accepts exact future-wall sent evidence only at or before explicitly selected business time',()=>{
 const at=new Date(Date.now()+86400000*5).toISOString(),f=fixture();f.raw.date=at;f.evidence={...evidence,occurredAt:at};
 expect(verifyRuntimeSentEmail(f)).toBeNull();
 expect(verifyRuntimeSentEmail({...f,businessClock:{now:()=>Date.parse(at)}})).toMatchObject({receipt:{submittedAt:at}});
 expect(verifyRuntimeSentEmail({...f,businessClock:{now:()=>Date.parse(at)-1}})).toBeNull();
});
