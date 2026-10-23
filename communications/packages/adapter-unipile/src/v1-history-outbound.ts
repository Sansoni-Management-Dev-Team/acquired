import { assertSameBinding, type ConnectionBinding, type CanonicalIdentity } from '../../contracts/src';
import type { HistoryOutboundObservation } from '../../core/src/history-backfill';
import type { RecordedLifecycleConnection } from '../../core/src/connection-lifecycle';
import { parseLifecycleRecord } from '../../core/src/connection-lifecycle';
import type { V1ReplyReadTransport, VerifiedReplyAlias } from './v1-reply-enrichment';
import { plain, opaque, vendorDate, portMethod, unavailable } from './v1-read-guard';
export interface HistoryOutboundOptions {
    record: RecordedLifecycleConnection;
    transport: V1ReplyReadTransport;
    ownerAddresses?: readonly string[];
    ownerProviderId?: string;
    product: 'whatsapp' | 'classic' | 'sales_navigator' | 'recruiter';
    resolveAlias(input: {
        binding: ConnectionBinding;
        providerAccountId: string;
        sourceId: string;
        providerId: string;
        product: string;
        signal: AbortSignal;
    }): Promise<VerifiedReplyAlias | null>;
}
/** Source's global account/owner/grant deadline surrounds this normalizer. It performs only bounded
 * original reads and returns recipient-specific observations, never replies or permission to send. */
export function createUnipileV1HistoryOutboundNormalizer(options: HistoryOutboundOptions) {
    const record = parseLifecycleRecord(options.record), getMail = portMethod<V1ReplyReadTransport['getEmail']>(options.transport, 'getEmail'), getChat = portMethod<V1ReplyReadTransport['getChat']>(options.transport, 'getChat'), getAttendees = portMethod<V1ReplyReadTransport['getChatAttendees']>(options.transport, 'getChatAttendees'), getMessage = portMethod<V1ReplyReadTransport['getMessage']>(options.transport, 'getMessage'), resolve = Function.prototype.bind.call(options.resolveAlias, options), owners = [...(options.ownerAddresses ?? [])], ownerProvider = options.ownerProviderId, product = options.product;
    const read = async (call: () => ReturnType<V1ReplyReadTransport['getEmail']>, signal: AbortSignal) => {
        if (signal.aborted)
            unavailable();
        const r = await call();
        if (signal.aborted || r.kind !== 'success' || r.status !== 200 || !plain(r.data))
            unavailable();
        return r.data;
    };
    return { async normalize(raw: unknown, binding: ConnectionBinding, signal: AbortSignal): Promise<HistoryOutboundObservation[] | null> {
            assertSameBinding(record.binding, binding);
            if (!plain(raw) || raw.account_id !== record.providerAccountId || !opaque(raw.id))
                unavailable();
            const reference = { binding: structuredClone(record.binding), id: raw.id };
            if (record.binding.channel === 'email') {
                if (typeof raw.role !== 'string')
                    return null;
                if (['draft', 'drafts'].includes(raw.role.toLowerCase()))
                    return [];
                const mail = await read(() => getMail(record.providerAccountId, raw.id as string, { signal }), signal);
                if (mail.object !== 'Email' || mail.kind !== '2_full' || mail.id !== raw.id || mail.account_id !== record.providerAccountId || typeof mail.role !== 'string' || mail.role !== raw.role || !vendorDate(mail.date) || !vendorDate(raw.date) || Date.parse(mail.date) !== Date.parse(raw.date) || !Array.isArray(mail.headers) || mail.headers.length === 0 || !plain(mail.from_attendee) || mail.from_attendee.identifier_type !== 'EMAIL_ADDRESS' || typeof mail.from_attendee.identifier !== 'string')
                    return null;
                if (!owners.includes(mail.from_attendee.identifier.toLowerCase()))
                    return mail.role === 'sent' ? null : [];
                // The full original email read is the authority for threading.
                // Missing metadata stays absent; it cannot satisfy a recorded
                // receipt that requires a conversation. Never infer a thread.
                if (mail.thread_id !== undefined && !opaque(mail.thread_id) || raw.thread_id !== undefined && (!opaque(raw.thread_id) || raw.thread_id !== mail.thread_id))
                    return null;
                const recipients = new Set<string>();
                for (const field of ['to_attendees', 'cc_attendees', 'bcc_attendees']) {
                    if (!Array.isArray(mail[field]) || mail[field].length > 1000)
                        return null;
                    for (const person of mail[field]) {
                        if (!plain(person) || person.identifier_type !== 'EMAIL_ADDRESS' || typeof person.identifier !== 'string' || !/^\S+@[^\s@]+\.[^\s@]+$/.test(person.identifier))
                            return null;
                        const value = person.identifier.toLowerCase();
                        if (!owners.includes(value))
                            recipients.add(value);
                    }
                }
                return [...recipients].map(value => ({ binding: structuredClone(record.binding), reference, ...(typeof mail.thread_id === 'string' ? { conversation: { binding: structuredClone(record.binding), id: mail.thread_id } } : {}), recipient: { kind: 'email', value }, occurredAt: new Date(mail.date as string).toISOString() }));
            }
            if (raw.is_sender !== 1)
                return [];
            if (raw.is_event === 1)
                return [];
            if (raw.hidden !== 0 || raw.deleted !== 0 || !opaque(raw.chat_id) || !opaque(ownerProvider) || !vendorDate(raw.timestamp))
                return null;
            const chat = await read(() => getChat(record.providerAccountId, raw.chat_id as string, { signal }), signal);
            if (chat.object !== 'Chat' || chat.id !== raw.chat_id || chat.account_id !== record.providerAccountId || chat.account_type !== record.binding.channel.toUpperCase())
                return null;
            if (chat.type === 1)
                return [];
            if (chat.type !== 0)
                return null;
            const list = await read(() => getAttendees(record.providerAccountId, raw.chat_id as string, { signal }), signal);
            if (list.object !== 'ChatAttendeeList' || list.cursor !== null || !Array.isArray(list.items) || list.items.length !== 2 || !list.items.every(a => plain(a) && a.object === 'ChatAttendee' && a.account_id === record.providerAccountId && opaque(a.id) && opaque(a.provider_id) && (a.is_self === 0 || a.is_self === 1)))
                return null;
            const own = list.items.filter(a => a.is_self === 1), peer = list.items.filter(a => a.is_self === 0);
            if (own.length !== 1 || peer.length !== 1 || own[0].provider_id !== ownerProvider || own[0].id === peer[0].id || own[0].provider_id === peer[0].provider_id)
                return null;
            const message = await read(() => getMessage(raw.id as string, { signal }), signal);
            if (message.object !== 'Message' || message.id !== raw.id || message.account_id !== record.providerAccountId || message.chat_id !== raw.chat_id || message.sender_id !== ownerProvider || message.sender_attendee_id !== own[0].id || message.is_sender !== 1 || message.is_event !== 0 || message.hidden !== 0 || message.deleted !== 0 || !vendorDate(message.timestamp) || Date.parse(message.timestamp) !== Date.parse(raw.timestamp))
                return null;
            const alias = await resolve({ binding: structuredClone(record.binding), providerAccountId: record.providerAccountId, sourceId: record.sourceId, providerId: peer[0].provider_id as string, product, signal });
            if (signal.aborted || !alias)
                return null;
            assertSameBinding(record.binding, alias.binding);
            if (alias.providerAccountId !== record.providerAccountId || alias.sourceId !== record.sourceId || alias.providerId !== peer[0].provider_id || alias.product !== product)
                return null;
            const identity = alias.identity as CanonicalIdentity;
            return [{ binding: structuredClone(record.binding), reference, conversation: { binding: structuredClone(record.binding), id: raw.chat_id }, recipient: { kind: identity.kind, value: identity.value }, occurredAt: new Date(message.timestamp as string).toISOString() }];
        } };
}
