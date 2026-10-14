import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ConnectionBinding, MessagingAdapter, MessageReceipt, CanonicalIdentity } from '../../contracts/src';
import { createUnipileV1EmailAdapter, type VerifiedV1EmailOriginal } from './v1-email';
import { createPostgresEmailTracking, createTrackedEmailSubmission, type EmailSentEvidence, type VerifiedEmailSentAssociation } from '../../storage-postgres/src/email-tracking';
import type { AccountRuntimeRepository, RuntimeConnection } from '../../storage-postgres/src/account-runtime';
import type { AccountRuntimeVault } from '../../storage-postgres/src/account-vault';
import type { SqlPool } from '../../storage-postgres/src/webhook-repository';
import type { UnipileV1Transport } from './v1-http';
import type { UnipileV1OwnerReader } from './v1-owner';
import type { UncertainDispatchRecord } from '../../core/src/dispatch';
import type { DeliveryOutcome } from '../../contracts/src';
import type { EmailTrackingRepository } from '../../storage-postgres/src/email-tracking';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v && Date.parse(v) <= Date.now();
/** Read the retained association first, then verify that exact receipt through the
 * original-account adapter. This does not reconcile, send or search by content. */
export async function recoverTrackedEmailOutcome(input: {
    record: UncertainDispatchRecord;
    tracking: Pick<EmailTrackingRepository, 'get'>;
    provider: Pick<MessagingAdapter, 'lookup'>;
    signal: AbortSignal;
}): Promise<DeliveryOutcome | null> {
    const original = structuredClone(input.record);
    if (input.signal.aborted || !['unknown', 'dispatching'].includes(original.state) || original.snapshot.binding.channel !== 'email' || original.snapshot.binding.backend !== 'unipile' || original.snapshot.operation !== 'message' || original.message)
        return null;
    const saved = await input.tracking.get(structuredClone(original.snapshot));
    if (input.signal.aborted || !saved?.association || !isDeepStrictEqual(saved.association.receipt.recipient, original.recipient))
        return null;
    const expected = { status: 'submitted' as const, receipt: structuredClone(saved.association.receipt) };
    const outcome = await input.provider.lookup({ snapshot: structuredClone(original.snapshot), message: structuredClone(expected.receipt.message), expectedRecipient: structuredClone(original.recipient) });
    return !input.signal.aborted && isDeepStrictEqual(outcome, expected) ? expected : null;
}
export function verifyRuntimeSentEmail(input: {
    binding: ConnectionBinding;
    ownerAddresses: string[];
    providerAccountId: string;
    raw: unknown;
    evidence: EmailSentEvidence;
    recipient: string;
    conversationId?: string;
}): VerifiedEmailSentAssociation | null {
    const r = input.raw, e = input.evidence, b = input.binding;
    if (!object(r) || r.object !== 'Email' || r.kind !== '2_full' || r.id !== e.emailId || r.account_id !== input.providerAccountId || e.providerAccountId !== input.providerAccountId || r.type !== { gmail: 'GOOGLE_OAUTH', outlook: 'OUTLOOK', imap: 'MAIL' }[b.platform as 'gmail' | 'outlook' | 'imap'] || r.role !== 'sent' || r.message_id !== e.rfcMessageId || r.date !== e.occurredAt || !date(r.date) || !/^<[^<>@\s]+@[^<>@\s]+>$/.test(e.rfcMessageId) || e.recipient !== input.recipient || !object(r.from_attendee) || !input.ownerAddresses.includes(r.from_attendee.identifier as string) || !Array.isArray(r.to_attendees) || r.to_attendees.length !== 1 || !object(r.to_attendees[0]) || r.to_attendees[0].identifier !== input.recipient || ['cc_attendees', 'bcc_attendees'].some(k => r[k] !== undefined && (!Array.isArray(r[k]) || r[k].length)) || !Array.isArray(r.headers) || input.conversationId !== undefined && r.thread_id !== input.conversationId)
        return null;
    const headers = r.headers.filter(h => object(h) && typeof h.name === 'string' && h.name.toLowerCase() === 'message-id');
    if (headers.length !== 1 || headers[0].value !== e.rfcMessageId)
        return null;
    const receipt: MessageReceipt = { message: { binding: structuredClone(b), id: e.emailId }, recipient: { kind: 'email', value: input.recipient }, submittedAt: r.date, ...(typeof r.thread_id === 'string' && r.thread_id.length ? { conversation: { binding: structuredClone(b), id: r.thread_id } } : {}) };
    return { receipt, rfcMessageId: e.rfcMessageId, evidenceDigest: createHash('sha256').update(JSON.stringify(['communications.verified-email.v1', b, input.providerAccountId, e, input.recipient, input.conversationId ?? null, r.id, r.message_id, r.date, r.from_attendee, r.to_attendees, r.headers, r.thread_id ?? null])).digest('hex') };
}
export interface RuntimeEmailOptions {
    pool: SqlPool;
    connection: RuntimeConnection;
    store: AccountRuntimeRepository;
    vault: AccountRuntimeVault;
    integrationId: string;
    providerConfigurationReference: string;
    transport: UnipileV1Transport;
    ownerReader: UnipileV1OwnerReader;
    authenticate(headers: readonly string[]): boolean;
}
export function createRuntimeEmail(options: RuntimeEmailOptions): {
    provider: MessagingAdapter;
    tracking: ReturnType<typeof createPostgresEmailTracking>;
} {
    const { connection, store, vault, transport, ownerReader } = options, b = structuredClone(connection.binding), owner = structuredClone(connection.owner), addresses = owner.aliases.filter(a => a.kind === 'email').map(a => a.value);
    const accessScope = { applicationId: b.applicationId, tenantId: b.tenantId, ownerId: b.ownerId };
    const ownership = async (signal: AbortSignal) => { await store.requireGrant({ ...accessScope }); const result = await ownerReader.verify({ platform: b.platform, providerAccountId: owner.providerAccountId, sourceId: owner.sourceId }, signal); await store.requireGrant({ ...accessScope }); return result.kind === 'verified' && isDeepStrictEqual(result.owner.physicalOwner, owner.physicalOwner) && isDeepStrictEqual(result.owner.providerOwner, owner.providerOwner) && isDeepStrictEqual(result.owner.aliases, owner.aliases); };
    const tracking = createPostgresEmailTracking({ pool: options.pool, binding: b, integrationId: options.integrationId, providerConfigurationReference: options.providerConfigurationReference, providerAccountId: owner.providerAccountId, codec: vault.journal,
        recipientDigest: { keyVersion: vault.identityKeyVersion, digest(identity: CanonicalIdentity, v: string) { return vault.physicalIdentityDigest({ namespace: identity.kind, value: identity.value }, v); } },
        trackingDigest: { keyVersion: vault.keyVersion, versions: vault.versions(), digest: (input, v) => vault.trackingDigest(input, v) },
        decodeProviderAccount(input) {
            const value = vault.open(input.binding, 'provider', { encrypted: input.encryptedProviderAccountId, keyVersion: input.keyVersion, digest: '' }) as {
                providerAccountId: string;
            };
            if (vault.providerAccountDigest(value.providerAccountId, input.keyVersion) !== input.digest)
                throw Error('Provider scope unavailable');
            return value.providerAccountId;
        },
        authenticateNotification: async (input) => options.authenticate(input.rawHeaders),
        async verifySentMessage(input, signal) {
            if (!await ownership(signal))
                return null;
            const result = await transport.getEmail(owner.providerAccountId, input.evidence.emailId, { signal });
            if (result.kind !== 'success' || result.status !== 200)
                return null;
            const proof = verifyRuntimeSentEmail({ binding: b, ownerAddresses: addresses, providerAccountId: owner.providerAccountId, raw: result.data, evidence: input.evidence, recipient: input.recipient, ...(input.conversationId ? { conversationId: input.conversationId } : {}) });
            await store.requireGrant({ ...accessScope });
            return proof;
        } });
    async function original(input: Parameters<NonNullable<Parameters<typeof createUnipileV1EmailAdapter>[0]['verifyOriginal']>>[0]): Promise<VerifiedV1EmailOriginal | null> {
        const recorded = await store.originalContext(input.snapshot);
        if (!isDeepStrictEqual(recorded.recipient, input.recipient) || input.conversation && !isDeepStrictEqual(recorded.conversation, input.conversation))
            return null;
        let message = input.message, conversation = input.conversation ?? recorded.conversation, rfc = input.rfcMessageId ?? recorded.rfcMessageId;
        if (message) {
            const saved = await tracking.get(input.snapshot);
            if (saved?.association) {
                if (!isDeepStrictEqual(saved.association.receipt.message, message))
                    return null;
                rfc = saved.association.rfcMessageId;
                conversation = saved.association.receipt.conversation;
            }
            else if (!recorded.message || !isDeepStrictEqual(recorded.message, message))
                return null;
        }
        else if (recorded.message) {
            message = recorded.message;
        }
        else if (conversation) {
            const result = await ownerReader.listThread(owner.providerAccountId, conversation.id, input.signal);
            if (result.kind !== 'success' || result.status !== 200 || !object(result.data) || result.data.object !== 'EmailList' || result.data.cursor !== null || !Array.isArray(result.data.items) || result.data.items.length !== 1)
                return null;
            const mail = result.data.items[0];
            if (!object(mail) || mail.thread_id !== conversation.id || typeof mail.id !== 'string' || typeof mail.message_id !== 'string')
                return null;
            message = { binding: b, id: mail.id };
            rfc = mail.message_id;
        }
        if (!message || !rfc)
            return null;
        return { providerAccountId: owner.providerAccountId, recipient: input.recipient, message, rfcMessageId: rfc, ...(conversation ? { conversation } : {}) };
    }
    const raw = createUnipileV1EmailAdapter({ connection: { binding: b, status: connection.status, capabilities: owner.capabilities, providerAccountId: owner.providerAccountId }, providerAccountId: owner.providerAccountId, sourceId: owner.sourceId, ownerAddresses: addresses, transport, verifyOwner: input => ownership(input.signal), verifyOriginal: original });
    return { provider: createTrackedEmailSubmission({ producer: raw, tracking }), tracking };
}
