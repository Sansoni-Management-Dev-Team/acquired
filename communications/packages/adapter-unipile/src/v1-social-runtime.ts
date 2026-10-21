import {businessNow,type BusinessClock} from '../../core/src/business-clock';
import { types, isDeepStrictEqual } from 'node:util';
import { assertSameBinding, ContractError, type MessagingAdapter, type ReceiptLookup, type SubmissionReceipt, type DeliveryOutcome, type CanonicalIdentity, type OperationSnapshot, type ProviderReference } from '../../contracts/src';
import type { UnipileV1TransportConfig } from './v1-http';
import { UnipileV1Transport } from './v1-http';
import { BoundedUnipileHttp, type UnipileHttpResult } from './http-core';
import type { AccountRuntimeRepository, RuntimeConnection } from '../../storage-postgres/src/account-runtime';
import type { UnipileV1OwnerReader } from './v1-owner';
import { messageDigest } from '../../core/src/message-digest';
import { normalizeV1MessageLookup, normalizeV1InvitationSent, normalizeV1MessageSent } from './v1-normalization';
import { createUnipileV1LinkedinRelationships } from './v1-relationships';
import { UnipileV1RelationshipsHttp } from './v1-relationships-http';
import {projectHistoryPeer} from './v1-history-peer';
import { plain, opaque, boundedRead, portMethod } from './v1-read-guard';
export interface V1SocialRuntimeOptions {
    businessClock?:BusinessClock;
    connection: RuntimeConnection;
    store: AccountRuntimeRepository;
    provider: UnipileV1TransportConfig;
    ownerReader: UnipileV1OwnerReader;
    timeoutMs?: number;
}
function fail(): never { throw Error('Social runtime unavailable'); }
function clone<T>(value: T): T {
    function inert(v: unknown, depth = 0): void {
        if (types.isPromise(v)) {
            void Promise.prototype.then.call(v, undefined, () => { });
            fail();
        }
        if (depth > 32)
            fail();
        if (v === null || ['undefined', 'boolean', 'string', 'number'].includes(typeof v))
            return;
        if (!v || typeof v !== 'object' || types.isProxy(v) || ![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(v)))
            fail();
        for (const d of Object.values(Object.getOwnPropertyDescriptors(v))) {
            if (!('value' in d))
                fail();
            inert(d.value, depth + 1);
        }
    }
    inert(value);
    return structuredClone(value);
}
/** One first-message POST creates the chat and sends text atomically. No empty-chat creation,
 * provider search after lost write, idempotency assumption, mutating retry or admission is supplied. */
export function createV1SocialRuntime(options: V1SocialRuntimeOptions): MessagingAdapter & {
    receiptDetails(lookup: ReceiptLookup, receipt: SubmissionReceipt): Promise<DeliveryOutcome | null>;
} {
    if (!plain(options))
        fail();
    const connection = clone(options.connection), b = connection.binding, o = connection.owner;
    const accessScope={applicationId:b.applicationId,tenantId:b.tenantId,ownerId:b.ownerId};
    assertSameBinding(b, b);
    if (b.backend !== 'unipile' || !['whatsapp', 'linkedin'].includes(b.channel) || !connection.active)
        fail();
    const timeout = options.timeoutMs ?? 20000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 25000)
        fail();
    const original = portMethod<AccountRuntimeRepository['originalContext']>(options.store, 'originalContext'), accepted = portMethod<AccountRuntimeRepository['originalReceipt']>(options.store, 'originalReceipt'), grant = portMethod<AccountRuntimeRepository['requireGrant']>(options.store, 'requireGrant'), owner = portMethod<UnipileV1OwnerReader['verify']>(options.ownerReader, 'verify');
    const transport = new UnipileV1Transport(options.provider), profiles = new UnipileV1RelationshipsHttp(options.provider), http = new BoundedUnipileHttp({ ...options.provider, basePath: '/api/v1', strictWriteRejections: true });
    function recipient(value: CanonicalIdentity) {
        if (b.channel === 'whatsapp') {
            if (value.kind !== 'phone' || !/^\+[1-9]\d{6,14}$/.test(value.value))
                fail();
        }
        else {
            if (value.kind !== 'linkedin_profile')
                fail();
            const u = new URL(value.value);
            if (u.protocol !== 'https:' || !['linkedin.com', 'www.linkedin.com'].includes(u.hostname) || u.port || u.username || u.password || u.search || u.hash || !/^\/in\/[^/]+\/?$/.test(u.pathname))
                fail();
        }
        return value;
    }
    function snapshot(value: OperationSnapshot) {
        assertSameBinding(b, value.binding);
        if (!opaque(value.key, 200) || !['message', 'invitation'].includes(value.operation) || !/^[a-f0-9]{64}$/.test(value.payloadDigest))
            throw new ContractError('operation_conflict');
    }
    function ref(value: ProviderReference) {
        assertSameBinding(b, value.binding);
        if (!opaque(value.id) || ['.', '..'].includes(value.id))
            fail();
    }
    async function authority(signal: AbortSignal, check: () => void) {
        await grant({...accessScope});
        check();
        const proof = await owner({ platform: b.platform, providerAccountId: o.providerAccountId, sourceId: o.sourceId }, signal);
        check();
        if (proof.kind !== 'verified' || proof.owner.status !== 'connected' || !isDeepStrictEqual(proof.owner.physicalOwner, o.physicalOwner) || !isDeepStrictEqual(proof.owner.providerOwner, o.providerOwner))
            fail();
        await grant({...accessScope});
        check();
    }
    async function peer(target: CanonicalIdentity, signal: AbortSignal, check: () => void): Promise<string> {
        recipient(target);
        const identifier = b.channel === 'whatsapp' ? target.value.slice(1) : new URL(target.value).pathname.split('/')[2];
        const result = await profiles.getProfile(o.providerAccountId, identifier, { signal });
        check();
        if (result.kind !== 'success' || result.status !== 200 || !plain(result.data))
            fail();
        const p = result.data;
        if (b.channel === 'whatsapp') {
            const verified=typeof p.id==='string'?projectHistoryPeer(p,p.id,'whatsapp'):null;
            if (!verified||verified.kind!==target.kind||verified.value!==target.value)
                fail();
            return p.id as string;
        }
        if (p.object !== 'UserProfile' || p.provider !== 'LINKEDIN' || !opaque(p.provider_id) || p.public_identifier !== identifier || p.is_self !== false || p.public_profile_url !== undefined && new URL(p.public_profile_url as string).pathname.replace(/\/$/, '') !== new URL(target.value).pathname.replace(/\/$/, ''))
            fail();
        return p.provider_id;
    }
    async function chat(id: string, peerId: string, signal: AbortSignal, check: () => void) {
        const result = await transport.getChat(o.providerAccountId, id, { signal });
        check();
        if (result.kind !== 'success' || result.status !== 200 || !plain(result.data) || result.data.object !== 'Chat' || result.data.id !== id || result.data.account_id !== o.providerAccountId || result.data.type !== 0 || result.data.read_only !== 0)
            fail();
        const attendees = await transport.getChatAttendees(o.providerAccountId, id, { signal });
        check();
        if (attendees.kind !== 'success' || attendees.status !== 200 || !plain(attendees.data) || attendees.data.object !== 'ChatAttendeeList' || attendees.data.cursor !== null || !Array.isArray(attendees.data.items) || attendees.data.items.length !== 2)
            fail();
        const list = attendees.data.items;
        if (list.some(a => !plain(a) || a.object !== 'ChatAttendee' || a.account_id !== o.providerAccountId || !opaque(a.id) || !opaque(a.provider_id) || ![0, 1].includes(a.is_self as number)))
            fail();
        const selves = list.filter(a => a.is_self === 1), peers = list.filter(a => a.is_self === 0), selfId = b.channel === 'whatsapp' ? `${o.physicalOwner.value.slice(1)}@s.whatsapp.net` : o.providerOwner.value;
        if (selves.length !== 1 || peers.length !== 1 || selves[0].provider_id !== selfId || peers[0].provider_id !== peerId || selves[0].id === peers[0].id)
            fail();
    }
    const relationships = b.channel === 'linkedin' ? createUnipileV1LinkedinRelationships({ now:()=>businessNow(options.businessClock),record: { binding: b, providerAccountId: o.providerAccountId, sourceId: o.sourceId, ownerIdentity: o.providerOwner }, transport: profiles, resolveCurrent: async (_binding, signal) => {
            try {
                await authority(signal, () => {
                    if (signal.aborted)
                        fail();
                });
                return { binding: b, providerAccountId: o.providerAccountId, sourceId: o.sourceId, ownerIdentity: o.providerOwner };
            }
            catch {
                return null;
            }
        }, submitInvitation: async () => ({ status: 'review', code: 'delivery_disabled' }) }) : undefined;
    const failure = (result: UnipileHttpResult): DeliveryOutcome => result.kind === 'not_submitted' ? { status: 'waiting', code: 'unavailable' } : result.kind === 'rejected' ? { status: 'review', code: result.reason === 'authentication' ? 'reconnect' : result.reason === 'authorization' ? 'forbidden' : 'protocol' } : { status: 'unknown' };
    async function details(lookup: ReceiptLookup, receipt: SubmissionReceipt, signal: AbortSignal, check: () => void): Promise<DeliveryOutcome | null> {
        snapshot(lookup.snapshot);
        recipient(receipt.recipient);
        if (!lookup.expectedRecipient || !isDeepStrictEqual(lookup.expectedRecipient, receipt.recipient))
            fail();
        await authority(signal, check);
        if ('operation' in receipt) {
            if (!relationships || lookup.snapshot.operation !== 'invitation')
                return null;
            ref(receipt.operation);
            return await relationships.lookupInvitation({ binding: b, invitation: receipt.operation, recipient: receipt.recipient }).then(v => v ? { status: 'submitted', receipt: v } : null);
        }
        if (!lookup.message || !isDeepStrictEqual(lookup.message, receipt.message) || !receipt.conversation)
            return null;
        ref(receipt.message);
        ref(receipt.conversation);
        const peerId = await peer(receipt.recipient, signal, check);
        await chat(receipt.conversation.id, peerId, signal, check);
        const response = await transport.getMessage(receipt.message.id, { signal });
        check();
        await grant({...accessScope});
        check();
        if (response.kind !== 'success' || response.status !== 200)
            return null;
        const found = normalizeV1MessageLookup(response.data, { lookup, providerAccountId: o.providerAccountId, conversation: receipt.conversation, recipient: receipt.recipient });
        return found.status === 'submitted' && 'message' in found.receipt && found.receipt.submittedAt && Date.parse(found.receipt.submittedAt) <= businessNow(options.businessClock) ? found : null;
    }
    return {
        async ready(requested) {
            assertSameBinding(b, clone(requested));
            if (!connection.active || connection.status !== 'connected' || !o.capabilities.messaging.send)
                return { status: 'review', code: 'reconnect' };
            try {
                await boundedRead(timeout, undefined, authority);
                return { status: 'ready' };
            }
            catch {
                return { status: 'waiting', code: 'unavailable' };
            }
        },
        async submit(request) {
            const input = clone(request);
            snapshot(input.snapshot);
            recipient(input.message.recipient);
            if (typeof input.message.text !== 'string' || input.message.text.length > 1000000 || messageDigest(input.snapshot.operation, input.message) !== input.snapshot.payloadDigest)
                throw new ContractError('operation_conflict');
            if (!plain(input.message) || Object.keys(input.message).some(k => !['recipient', 'text', 'conversation'].includes(k)) || input.snapshot.operation === 'invitation' && (b.channel !== 'linkedin' || input.message.conversation || input.message.text.length > 300))
                return { status: 'review', code: 'unsupported' };
            let writing = false;
            let acknowledged: Extract<DeliveryOutcome, {
                status: 'submitted';
            }> | undefined;
            try {
                return await boundedRead(timeout, undefined, async (signal, check) => {
                    await authority(signal, check);
                    const context = await original(input.snapshot);
                    check();
                    if (!isDeepStrictEqual(context.recipient, input.message.recipient) || !isDeepStrictEqual(context.conversation, input.message.conversation))
                        fail();
                    const peerId = await peer(input.message.recipient, signal, check);
                    let response: UnipileHttpResult;
                    if (input.snapshot.operation === 'invitation') {
                        writing = true;
                        response = await transport.invite(o.providerAccountId, peerId, input.message.text, { signal });
                        check();
                        if (response.kind !== 'success')
                            return failure(response);
                        const ack = normalizeV1InvitationSent(response.data, input);
                        if (ack.status === 'submitted')
                            acknowledged = clone(ack);
                        if (ack.status === 'submitted' && 'operation' in ack.receipt) {
                            try {
                                const time = await relationships!.lookupInvitation({ binding: b, invitation: ack.receipt.operation, recipient: ack.receipt.recipient });
                                check();
                                if (time)
                                    return { status: 'submitted' as const, receipt: time };
                            }
                            catch { /* Preserve original acknowledgement. */ }
                        }
                        return ack;
                    }
                    if (input.message.conversation) {
                        ref(input.message.conversation);
                        await chat(input.message.conversation.id, peerId, signal, check);
                        await grant({...accessScope});
                        check();
                        writing = true;
                        response = await transport.sendMessage(o.providerAccountId, input.message.conversation.id, { text: input.message.text }, { signal });
                        check();
                    }
                    else {
                        const form = new FormData();
                        form.set('account_id', o.providerAccountId);
                        form.set('text', input.message.text);
                        form.append('attendees_ids', peerId);
                        await grant({...accessScope});
                        check();
                        writing = true;
                        response = await http.request('POST', http.url('chats'), form, { signal });
                        check();
                    }
                    if (response.kind !== 'success')
                        return failure(response);
                    let ack: DeliveryOutcome;
                    if (input.message.conversation)
                        ack = response.status === 201 ? normalizeV1MessageSent(response.data, input) : { status: 'unknown' };
                    else if (response.status === 201 && plain(response.data) && response.data.object === 'ChatStarted' && opaque(response.data.chat_id) && opaque(response.data.message_id))
                        ack = { status: 'submitted', receipt: { message: { binding: clone(b), id: response.data.message_id }, conversation: { binding: clone(b), id: response.data.chat_id }, recipient: clone(input.message.recipient) } };
                    else
                        ack = { status: 'unknown' };
                    if (ack.status === 'submitted')
                        acknowledged = clone(ack);
                    if (ack.status === 'submitted' && 'message' in ack.receipt) {
                        try {
                            const enriched = await details({ snapshot: input.snapshot, message: ack.receipt.message, expectedRecipient: ack.receipt.recipient }, ack.receipt, signal, check);
                            if (enriched)
                                return enriched;
                        }
                        catch { /* A read failure cannot undo a known accepted message. */ }
                    }
                    return ack;
                });
            }
            catch {
                return acknowledged ?? (writing ? { status: 'unknown' } : { status: 'review', code: 'protocol' });
            }
        },
        async lookup(request) {
            const lookup = clone(request);
            snapshot(lookup.snapshot);
            try {
                const receipt = await accepted(lookup.snapshot);
                if (!receipt)
                    return null;
                return await boundedRead(timeout, undefined, (signal, check) => details(lookup, receipt, signal, check));
            }
            catch {
                return { status: 'unknown' };
            }
        },
        async receiptDetails(request, stored) {
            const lookup = clone(request), receipt = clone(stored);
            snapshot(lookup.snapshot);
            try {
                return await boundedRead(timeout, undefined, (signal, check) => details(lookup, receipt, signal, check));
            }
            catch {
                return null;
            }
        }
    };
}
