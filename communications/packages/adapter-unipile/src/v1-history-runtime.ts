import { projectHistoryPeer } from './v1-history-peer';
import { isDeepStrictEqual } from 'node:util';
import { assertSameBinding, type ConnectionBinding, type EventQuery, type MessageSubmission, type DeliveryOutcome } from '../../contracts/src';
import type { ConfiguredUnipileV1Runtime } from './v1-runtime';
import type { UnipileV1TransportConfig } from './v1-http';
import { UnipileV1Transport } from './v1-http';
import { UnipileV1HistoryHttp } from './v1-history-http';
import { UnipileV1RelationshipsHttp } from './v1-relationships-http';
import { UnipileV1OwnerReader } from './v1-owner';
import { createUnipileV1ReplyEnricher, type VerifiedReplyAlias } from './v1-reply-enrichment';
import { createUnipileV1HistorySource } from './v1-history';
import { createUnipileV1LinkedinRelationships } from './v1-relationships';
import { createUnipileV1HistoryOutboundNormalizer } from './v1-history-outbound';
import { createPostgresHistoryCheckpoints } from '../../storage-postgres/src/history-checkpoints';
import { createPostgresHistoryAliases } from '../../storage-postgres/src/history-aliases';
import { createJournalOutboundVerifier } from '../../storage-postgres/src/journal-outbound';
import { createHistoryBackfillWorker } from '../../core/src/history-backfill';
import type { HistoryCheckpointCodec } from '../../storage-postgres/src/history-checkpoint-codec';
import type { SqlPool, WebhookEventRepositoryCodec, WebhookRepositoryCodec } from '../../storage-postgres/src/webhook-repository';
import { plain, opaque, unavailable, portMethod } from './v1-read-guard';
export interface ConfiguredHistoryOptions {
    binding: ConnectionBinding;
    runtime: ConfiguredUnipileV1Runtime;
    pool: SqlPool;
    provider: UnipileV1TransportConfig;
    integrationId: string;
    providerConfigurationReference: string;
    subscriberId: string;
    codec: HistoryCheckpointCodec;
    eventCodec: WebhookEventRepositoryCodec;
    captureCodec: WebhookRepositoryCodec;
    product?: 'whatsapp' | 'classic' | 'sales_navigator' | 'recruiter';
    expectedSyncProduct?: string;
    scopeKeyVersion?: string;
    availableFrom?: string;
    dispatchInvitation?(input: MessageSubmission, signal: AbortSignal): Promise<DeliveryOutcome>;
}
/** Concrete service-only composition. Reads resolve only original encrypted owner/account metadata;
 * peer mappings are authenticated via profile reads and retained scoped aliases. Invitation mutation
 * MUST be supplied by the host's durable held-admission coordinator; no raw provider fallback. */
export async function createConfiguredUnipileV1History(options: ConfiguredHistoryOptions) {
    if (!plain(options))
        unavailable();
    const b = structuredClone(options.binding);
    assertSameBinding(b, b);
    const runtime = options.runtime, resolve = portMethod<ConfiguredUnipileV1Runtime['resolveCurrent']>(runtime, 'resolveCurrent'), get = portMethod<ConfiguredUnipileV1Runtime['store']['resolve']>(runtime.store, 'resolve'), dispatch = portMethod<ConfiguredUnipileV1Runtime['dispatchOptions']>(runtime, 'dispatchOptions'), digests = portMethod<ConfiguredUnipileV1Runtime['providerAccountDigests']>(runtime, 'providerAccountDigests'), config = structuredClone({ ...options.provider, fetch: undefined }) as UnipileV1TransportConfig;
    if (options.provider.fetch)
        config.fetch = options.provider.fetch;
    const transport = new UnipileV1Transport(config), profiles = new UnipileV1RelationshipsHttp(config), ownerReader = new UnipileV1OwnerReader(config), historyTransport = new UnipileV1HistoryHttp(config), product = options.product ?? (b.channel === 'whatsapp' ? 'whatsapp' : 'classic'), pool = options.pool, codec = options.codec, eventCodec = options.eventCodec, captureCodec = options.captureCodec, integration = options.integrationId, configuration = options.providerConfigurationReference, subscriber = options.subscriberId, availableFrom = options.availableFrom, expectedProduct = options.expectedSyncProduct, send = options.dispatchInvitation ? Function.prototype.bind.call(options.dispatchInvitation, options) : null;
    const scopeKeyVersion = options.scopeKeyVersion;
    const connection = await get(b);
    if (!connection || !connection.active)
        unavailable();
    assertSameBinding(b, connection.binding);
    const original = structuredClone(connection.owner), record = await resolve(b);
    if (!record || record.providerAccountId !== original.providerAccountId || record.sourceId !== original.sourceId || !isDeepStrictEqual(record.ownerIdentity, original.providerOwner))
        unavailable();
    assertSameBinding(b, record.binding);
    const journal = await dispatch(b), providerDigests = await digests(b);
    if (journal.integrationId !== integration || journal.providerConfigurationReference !== configuration)
        unavailable();
    const isRecordedOutbound = createJournalOutboundVerifier({ binding: b, integrationId: integration, providerConfigurationReference: configuration, providerAccountDigests: providerDigests, codec: journal.codec, recipientDigest: journal.recipientDigest });
    const repository = createPostgresHistoryCheckpoints({ pool, binding: b, record, integrationId: integration, providerConfigurationReference: configuration, subscriberId: subscriber, codec, eventCodec, captureCodec, expectedSyncProduct: expectedProduct, scopeKeyVersion, isRecordedOutbound }), aliases = createPostgresHistoryAliases({ pool, record, codec, product });
    const currentDb = async (requested: ConnectionBinding, signal: AbortSignal) => {
        if (signal.aborted)
            return null;
        assertSameBinding(b, requested);
        const now = await resolve(b);
        if (signal.aborted)
            return null;
        return now;
    };
    const verifyOwner = async (signal: AbortSignal) => {
        if (!await currentDb(b, signal))
            return false;
        const proof = await ownerReader.verify({ platform: b.platform, providerAccountId: record.providerAccountId, sourceId: record.sourceId }, signal);
        if (signal.aborted || proof.kind !== 'verified' || proof.owner.status !== 'connected' || !isDeepStrictEqual(proof.owner.providerOwner, original.providerOwner) || !isDeepStrictEqual(proof.owner.physicalOwner, original.physicalOwner))
            return false;
        return !!await currentDb(b, signal);
    };
    const current = async (requested: ConnectionBinding, signal: AbortSignal) => await verifyOwner(signal) ? currentDb(requested, signal) : null;
    const resolveAlias = async (input: {
        binding: ConnectionBinding;
        providerAccountId: string;
        sourceId: string;
        providerId: string;
        product: string;
        signal: AbortSignal;
    }): Promise<VerifiedReplyAlias | null> => {
        assertSameBinding(b, input.binding);
        if (input.providerAccountId !== record.providerAccountId || input.sourceId !== record.sourceId || input.product !== product || !opaque(input.providerId) || !await verifyOwner(input.signal))
            return null;
        const result = await profiles.getProfile(record.providerAccountId, input.providerId, { signal: input.signal });
        if (input.signal.aborted || result.kind !== 'success' || result.status !== 200 || !plain(result.data))
            return null;
        let identity = projectHistoryPeer(result.data, input.providerId, b.channel as 'whatsapp' | 'linkedin');
        if (!identity)
            return null;
        if (!await verifyOwner(input.signal))
            return null;
        const retained = await aliases.get(input.providerId, input.signal);
        if (retained)
            identity = retained;
        else
            await aliases.put(input.providerId, identity, input.signal);
        if (!await currentDb(b, input.signal))
            return null;
        return { binding: structuredClone(b), providerAccountId: record.providerAccountId, sourceId: record.sourceId, providerId: input.providerId, product, identity };
    };
    const addresses = original.aliases.filter(a => a.kind === 'email').map(a => a.value), ownerProvider = b.channel === 'whatsapp' ? `${original.physicalOwner.value.slice(1)}@s.whatsapp.net` : original.providerOwner.value;
    const normalizer = (allFolders: boolean) => async (raw: unknown, binding: ConnectionBinding) => {
        const time = b.channel === 'email' && plain(raw) ? raw.date : plain(raw) ? raw.timestamp : null;
        if (typeof time !== 'string')
            return { kind: 'review' as const, code: 'protocol' as const };
        const enricher = createUnipileV1ReplyEnricher({ binding: b, providerAccountId: record.providerAccountId, sourceId: record.sourceId, eventsFrom: time, transport, verifyOwner: input => verifyOwner(input.signal), resolveAlias, ...(b.channel === 'email' ? { channel: 'email' as const, ownerAddresses: addresses, ...(allFolders ? { historyAllFolders: true as const } : {}) } : { channel: b.channel, ownerProviderId: ownerProvider, product: product as 'whatsapp' | 'classic' | 'sales_navigator' | 'recruiter' }) });
        return enricher.normalize(raw, binding);
    };
    const normalize = normalizer(true), normalizeWebhook = normalizer(false);
    const outbound = createUnipileV1HistoryOutboundNormalizer({ record, transport, ownerAddresses: addresses, ownerProviderId: ownerProvider, product, resolveAlias }), source = createUnipileV1HistorySource({ record, transport: historyTransport, resolveCurrent: current, initialSync: (_record, signal) => repository.initialSync(signal), normalize, normalizeOutbound: (raw, binding, signal) => outbound.normalize(raw, binding, signal), availableFrom, ...(b.channel !== 'email' ? { eventAccountInfo: { ownerProviderId: ownerProvider, product } } : {}) }), worker = createHistoryBackfillWorker({ source, repository });
    const relationships = b.channel === 'linkedin' ? createUnipileV1LinkedinRelationships({ record, transport: profiles, resolveCurrent: current, submitInvitation: async (input, signal) => {
            if (!send)
                return { status: 'review', code: 'delivery_disabled' };
            if (signal.aborted)
                unavailable();
            return send(input, signal);
        } }) : null;
    return { repository, source, relationships, normalizeWebhook, refresh(query: EventQuery, request?: {
            signal?: AbortSignal;
        }) { return worker.refresh(query, request); } };
}
