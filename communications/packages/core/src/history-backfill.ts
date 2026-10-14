import { parseEventPayload } from './event-codec';
import { assertSameBinding, type EventQuery, type EventPage, type Coverage, type ConnectionBinding, type ProviderReference, type CanonicalIdentity } from '../../contracts/src';
import type { RecordedLifecycleConnection } from './connection-lifecycle';
export interface HistoryOutboundObservation {
    binding: ConnectionBinding;
    reference: ProviderReference;
    conversation?: ProviderReference;
    recipient: CanonicalIdentity;
    occurredAt: string;
}
export function parseHistoryOutbound(input: HistoryOutboundObservation, binding: ConnectionBinding): HistoryOutboundObservation {
    assertSameBinding(binding, input.binding);
    const payload = parseEventPayload({ binding, key: 'outbound-validation' }, { outcome: { kind: 'event', event: { type: 'message', reference: input.reference, ...(input.conversation ? { conversation: input.conversation } : {}), direction: 'outbound', sender: input.recipient, occurredAt: input.occurredAt }, eventKey: 'outbound-validation', fingerprint: '0'.repeat(64) }, fingerprint: '0'.repeat(64), receivedAt: input.occurredAt });
    if (payload.outcome.kind !== 'event' || payload.outcome.event.type !== 'message')
        throw Error('History outbound unavailable');
    const event = payload.outcome.event;
    return { binding: structuredClone(binding), reference: event.reference, ...(event.conversation ? { conversation: event.conversation } : {}), recipient: event.sender, occurredAt: new Date(event.occurredAt).toISOString() };
}
export interface HistoryInitialSyncEvidence {
    kind: 'provider_sync_success' | 'query_baseline';
    record: RecordedLifecycleConnection;
    completedAt: string;
    evidenceId: string;
    query?: {
        scope: string;
        from: string;
        through: string;
    };
}
export interface HistoryRefreshTicket {
    binding: ConnectionBinding;
    scope: string;
    since: string;
    token: string;
    startedAt: string;
    revision: string;
}
export interface HistoryCheckpointPort {
    begin(query: EventQuery, signal?: AbortSignal): Promise<HistoryRefreshTicket | null>;
    commit(ticket: HistoryRefreshTicket, page: EventPage, signal?: AbortSignal): Promise<{
        committed: boolean;
        coverage: Coverage;
    }>;
    invalidate(query: EventQuery, signal?: AbortSignal): Promise<void>;
    coverage(query: EventQuery, signal?: AbortSignal): Promise<Coverage | null>;
}
export function createHistoryBackfillWorker(options: {
    source: {
        read(query: EventQuery, options?: {
            signal?: AbortSignal;
            through?: string;
        }): Promise<EventPage>;
    };
    repository: HistoryCheckpointPort;
}): {
    refresh(query: EventQuery, options?: {
        signal?: AbortSignal;
    }): Promise<{
        status: 'complete' | 'pending' | 'busy' | 'retry';
        coverage?: Coverage;
    }>;
} {
    const read = Function.prototype.bind.call(options.source.read, options.source), begin = Function.prototype.bind.call(options.repository.begin, options.repository), commit = Function.prototype.bind.call(options.repository.commit, options.repository), invalidate = Function.prototype.bind.call(options.repository.invalidate, options.repository);
    return { async refresh(input, request) {
            const query = structuredClone(input), signal = request?.signal;
            try {
                assertSameBinding(query.binding, query.binding);
                if (query.cursor !== null || query.refresh !== true || signal?.aborted)
                    return { status: 'retry' };
                const ticket = structuredClone(await begin(structuredClone(query), signal));
                if (!ticket)
                    return { status: 'busy' };
                assertSameBinding(query.binding, ticket.binding);
                if (ticket.scope !== query.scope || ticket.since !== query.since || signal?.aborted)
                    throw Error();
                const page = structuredClone(await read(structuredClone(query), { signal, through: ticket.startedAt }));
                assertSameBinding(query.binding, page.coverage.binding);
                if (page.coverage.scope !== query.scope || page.coverage.from !== query.since || page.coverage.through !== ticket.startedAt || page.nextCursor !== null || signal?.aborted)
                    throw Error();
                const result = structuredClone(await commit(structuredClone(ticket), structuredClone(page), signal));
                if (result.committed !== true)
                    return { status: 'retry' };
                assertSameBinding(query.binding, result.coverage.binding);
                if (result.coverage.scope !== query.scope)
                    return { status: 'retry' };
                return { status: result.coverage.complete && result.coverage.initialSyncComplete && !result.coverage.invalidated ? 'complete' : 'pending', coverage: result.coverage };
            }
            catch {
                try {
                    await invalidate(structuredClone(query), signal);
                }
                catch { /* A failed invalidation cannot authorize readiness; claim began by invalidating durable coverage. */ }
                return { status: 'retry' };
            }
        } };
}
