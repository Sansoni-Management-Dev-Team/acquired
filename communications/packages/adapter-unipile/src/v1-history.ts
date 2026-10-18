import { createHash } from 'node:crypto';
import { parseHistoryOutbound, type HistoryInitialSyncEvidence, type HistoryOutboundObservation } from '../../core/src/history-backfill';
import { assertSameBinding, type ConnectionBinding, type EventQuery, type EventPage, type CommunicationEvent } from '../../contracts/src';
import { parseLifecycleRecord, type RecordedLifecycleConnection } from '../../core/src/connection-lifecycle';
import type { UnipileHttpResult, UnipileRequestOptions } from './http-core';
import { projectV1Account } from './v1-account-lifecycle';
import type { V1ReplyEventResult } from './v1-events';
import { plain, opaque, utc, pinned, boundedRead, unavailable, vendorDate, portMethod } from './v1-read-guard';
export interface HistoryListRequest {
    accountId: string;
    channel: 'email' | 'whatsapp' | 'linkedin';
    after: string;
    before: string;
    cursor: string | null;
    limit: number;
}
export interface V1HistoryTransport {
    getAccount(id: string, options?: UnipileRequestOptions): Promise<UnipileHttpResult>;
    list(input: HistoryListRequest, options?: UnipileRequestOptions): Promise<UnipileHttpResult>;
}
/** Evidence must originate from authenticated original-source sync completion, not account OK or a
 * caller's guessed boolean. Gmail/Outlook lack the documented social SYNC_SUCCESS guarantee. */
export type InitialSyncEvidence = HistoryInitialSyncEvidence;
export interface V1HistoryOptions {
    record: RecordedLifecycleConnection;
    transport: V1HistoryTransport;
    resolveCurrent(binding: ConnectionBinding, signal: AbortSignal): Promise<RecordedLifecycleConnection | null>;
    initialSync(record: RecordedLifecycleConnection, signal: AbortSignal): Promise<InitialSyncEvidence | null>;
    normalize(raw: unknown, binding: ConnectionBinding): Promise<V1ReplyEventResult>;
    normalizeOutbound?(raw: unknown, binding: ConnectionBinding, signal: AbortSignal): Promise<HistoryOutboundObservation[] | null>;
    availableFrom?: string;
    eventAccountInfo?: {
        ownerProviderId: string;
        product: "whatsapp" | "classic" | "sales_navigator" | "recruiter";
    };
    now?: () => number;
    deadlineMs?: number;
    maxPages?: number;
    maxItems?: number;
}
const sameRecord = (a: RecordedLifecycleConnection, b: RecordedLifecycleConnection) => {
    assertSameBinding(a.binding, b.binding);
    if (a.providerAccountId !== b.providerAccountId || a.sourceId !== b.sourceId || a.ownerIdentity.namespace !== b.ownerIdentity.namespace || a.ownerIdentity.value !== b.ownerIdentity.value)
        unavailable();
};
/** Exhaustive account-wide, all-folder scan in an anchored inclusive window. Vendor cursors do not
 * promise a globally consistent snapshot; completeness means documented pagination was exhausted
 * against a healthy uncached source, not that deleted/late-arriving vendor data can be recovered. */
export function createUnipileV1HistorySource(options: V1HistoryOptions): {
    read(query: EventQuery, options?: {
        signal?: AbortSignal;
        through?: string;
    }): Promise<EventPage>;
} {
    if (!plain(options))
        unavailable();
    const record = parseLifecycleRecord(options.record), getAccount = portMethod<V1HistoryTransport['getAccount']>(options.transport, 'getAccount'), list = portMethod<V1HistoryTransport['list']>(options.transport, 'list'), resolve = pinned(options.resolveCurrent, options), sync = pinned(options.initialSync, options), normalize = pinned(options.normalize, options), now = options.now ? pinned(options.now, options) : Date.now;
    const info = options.eventAccountInfo === undefined ? null : structuredClone(options.eventAccountInfo);
    if (record.binding.channel !== 'email' && (!plain(info) || !opaque(info.ownerProviderId) || (record.binding.channel === 'whatsapp' ? info.product !== 'whatsapp' : !['classic', 'sales_navigator', 'recruiter'].includes(info.product))))
        unavailable();
    const availableFrom = options.availableFrom;
    if (availableFrom !== undefined && !utc(availableFrom))
        unavailable();
    const outgoing = options.normalizeOutbound ? pinned(options.normalizeOutbound, options) : null;
    const deadline = options.deadlineMs ?? 25000, maxPages = options.maxPages ?? 50, maxItems = options.maxItems ?? 10000;
    if (!Number.isSafeInteger(deadline) || deadline < 1 || deadline > 60000 || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1000 || !Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 100000)
        unavailable();
    return { async read(input, requestOptions) {
            if (!plain(input) || Object.keys(input).some(k => !['binding', 'scope', 'since', 'cursor', 'refresh'].includes(k)) || !opaque(input.scope, 200) || !utc(input.since) || input.cursor !== null || typeof input.refresh !== 'boolean')
                unavailable();
            const safeBinding = parseLifecycleRecord({ binding: input.binding, providerAccountId: record.providerAccountId, sourceId: record.sourceId, ownerIdentity: record.ownerIdentity }).binding;
            assertSameBinding(record.binding, safeBinding);
            const q: EventQuery = { binding: safeBinding, scope: input.scope, since: input.since, cursor: null, refresh: input.refresh };
            const actualStart = now();
            if (requestOptions?.through !== undefined && !utc(requestOptions.through))
                unavailable();
            const started = requestOptions?.through ? Date.parse(requestOptions.through) : actualStart;
            if (!Number.isFinite(started) || started > actualStart || Date.parse(q.since) > started || availableFrom !== undefined && Date.parse(q.since) < Date.parse(availableFrom))
                unavailable();
            const through = new Date(started).toISOString(), after = new Date(Date.parse(q.since) - 1).toISOString(), before = new Date(started + 1).toISOString();
            return boundedRead(deadline, requestOptions?.signal, async (signal, check) => {
                const authority = async () => {
                    check();
                    const found = await resolve(structuredClone(record.binding), signal);
                    check();
                    if (found === null)
                        unavailable();
                    sameRecord(record, parseLifecycleRecord(found));
                };
                const read = async (call: () => Promise<UnipileHttpResult>) => {
                    check();
                    const result = structuredClone(await call());
                    check();
                    if (!plain(result) || result.kind !== 'success' || result.status !== 200)
                        unavailable();
                    return result.data;
                };
                await authority();
                const account = await read(() => getAccount(record.providerAccountId, { signal })), status = projectV1Account(account, record);
                if (status.status !== 'observed' || status.observation.status !== 'connected' || record.binding.channel !== 'email' && (!plain(account) || !Array.isArray(account.sources) || account.sources.length !== 1))
                    unavailable();
                let evidence = structuredClone(await sync(structuredClone(record), signal));
                check();
                let initial = false;
                if (evidence !== null) {
                    if (!plain(evidence) || !utc(evidence.completedAt) || Date.parse(evidence.completedAt) > started || !opaque(evidence.evidenceId) || evidence.kind !== 'provider_sync_success' || record.binding.channel === 'email')
                        unavailable();
                    sameRecord(record, parseLifecycleRecord(evidence.record));
                    initial = true;
                }
                const outbound: HistoryOutboundObservation[] = [];
                const events: CommunicationEvent[] = [], seen = new Map<string, string>(), cursors = new Set<string>();
                let cursor: string | null = null, items = 0, ambiguous = false;
                for (let page = 0;; page++) {
                    if (page >= maxPages)
                        unavailable();
                    const raw = await read(() => list({ accountId: record.providerAccountId, channel: record.binding.channel, after, before, cursor, limit: 250 }, { signal }));
                    if (!plain(raw) || raw.object !== (record.binding.channel === 'email' ? 'EmailList' : 'MessageList') || !Array.isArray(raw.items) || raw.items.length > 250 || !(raw.cursor === null || opaque(raw.cursor, 16384)))
                        unavailable();
                    for (const item of raw.items) {
                        check();
                        if (++items > maxItems)
                            unavailable();
                        if (!plain(item) || item.account_id !== record.providerAccountId || !opaque(item.id) || !vendorDate(record.binding.channel === 'email' ? item.date : item.timestamp))
                            unavailable();
                        const timestamp = (record.binding.channel === 'email' ? item.date : item.timestamp) as string, time = Date.parse(timestamp);
                        if (time < Date.parse(q.since) || time > started)
                            continue;
                        let payload: Record<string, unknown>;
                        if (record.binding.channel === 'email')
                            payload = { ...item, event: 'mail_received', email_id: item.id };
                        else {
                            if ([item.is_sender, item.is_event, item.hidden, item.deleted].some(f => f !== 0 && f !== 1) || !opaque(item.chat_id) || !opaque(item.sender_id) || !opaque(item.sender_attendee_id))
                                unavailable();
                            if (item.is_sender === 0 && (item.deleted === 1 || item.hidden === 1)) {
                                ambiguous = true;
                                continue;
                            }
                            payload = { ...item, event: 'message_received', account_type: record.binding.channel.toUpperCase(), account_info: { type: record.binding.channel.toUpperCase(), user_id: info!.ownerProviderId, ...(record.binding.channel === 'linkedin' ? { feature: info!.product } : {}) }, message_id: item.id, sender: { attendee_provider_id: item.sender_id, attendee_id: item.sender_attendee_id } };
                        }
                        if (record.binding.channel === 'email' || item.is_sender === 1) {
                            if (!outgoing) {
                                ambiguous = true;
                                continue;
                            }
                            const observed = structuredClone(await outgoing(item, structuredClone(record.binding), signal));
                            check();
                            if (observed === null) {
                                ambiguous = true;
                                continue;
                            }
                            if (!Array.isArray(observed))
                                unavailable();
                            for (const observation of observed) {
                                const validated = parseHistoryOutbound(observation, record.binding);
                                if (validated.reference.id !== item.id || Date.parse(validated.occurredAt) !== time || record.binding.channel !== 'email' && validated.conversation?.id !== item.chat_id)
                                    unavailable();
                                outbound.push(validated);
                            }
                            if (record.binding.channel !== 'email' || observed.length > 0)
                                continue;
                        }
                        const normalized = structuredClone(await normalize(payload, structuredClone(record.binding)));
                        check();
                        if (!plain(normalized))
                            unavailable();
                        if (normalized.kind === 'review') {
                            ambiguous = true;
                            continue;
                        }
                        if (normalized.kind === 'ignore')
                            continue;
                        if(normalized.kind==='event'&&normalized.event.type==='email_change'&&normalized.event.change==='bounce')continue;
                        if (normalized.kind !== 'event' || !plain(normalized.event) || normalized.event.type !== 'message')
                            unavailable();
                        const event = normalized.event as unknown as Extract<CommunicationEvent, {
                            type: 'message';
                        }>;
                        assertSameBinding(record.binding, event.reference.binding);
                        if (event.reference.id !== item.id || !vendorDate(event.occurredAt) || Date.parse(event.occurredAt) !== time || event.conversation && event.conversation.id !== item.chat_id)
                            unavailable();
                        event.occurredAt = new Date(event.occurredAt).toISOString();
                        const key = JSON.stringify([event.reference.id, event.conversation?.id ?? null]), value = JSON.stringify(event);
                        if (seen.has(key) && seen.get(key) !== value) {
                            ambiguous = true;
                            continue;
                        }
                        if (!seen.has(key)) {
                            seen.set(key, value);
                            events.push(event);
                        }
                    }
                    if (raw.cursor === null)
                        break;
                    if (cursors.has(raw.cursor))
                        unavailable();
                    cursors.add(raw.cursor);
                    cursor = raw.cursor;
                }
                await authority();
                const finalRawAccount = await read(() => getAccount(record.providerAccountId, { signal }));
                const finalAccount = projectV1Account(finalRawAccount, record);
                if (finalAccount.status !== 'observed' || finalAccount.observation.status !== 'connected' || record.binding.channel !== 'email' && (!plain(finalRawAccount) || !Array.isArray(finalRawAccount.sources) || finalRawAccount.sources.length !== 1))
                    unavailable();
                await authority();
                check();
                const ended = now();
                if (!Number.isFinite(ended) || ended < started)
                    unavailable();
                if (record.binding.channel === 'email' && evidence === null && q.refresh && !ambiguous) {
                    evidence = { kind: 'query_baseline', record: structuredClone(record), completedAt: new Date(ended).toISOString(), evidenceId: createHash('sha256').update(JSON.stringify(['communications.history.query-baseline.v1', record, q.scope, q.since, through, ended])).digest('hex'), query: { scope: q.scope, from: q.since, through } };
                    initial = true;
                }
                const complete = q.refresh && initial && !ambiguous;
                return { events, nextCursor: null, provenance: { providerAccountId: record.providerAccountId, sourceId: record.sourceId, initialSyncEvidence: evidence, outbound, exhausted: true, refresh: q.refresh }, coverage: { binding: structuredClone(record.binding), scope: q.scope, from: q.since, through, observedAt: new Date(ended).toISOString(), complete, initialSyncComplete: initial, invalidated: ambiguous }, ...(!complete ? { wait: { code: 'incomplete' as const } } : {}) };
            });
        } };
}
