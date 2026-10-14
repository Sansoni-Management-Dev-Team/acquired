import { describe, it, expect, vi } from 'vitest';
import { createUnipileV1HistorySource, type HistoryListRequest } from './v1-history';
import type { UnipileHttpResult } from './http-core';
import type { ConnectionBinding, EventQuery } from '../../contracts/src';
const b: ConnectionBinding = { applicationId: 'app', tenantId: 'tenant', ownerId: 'owner', connectionId: 'c', accountId: 'a', generation: 1, channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile' };
const start = '2026-10-14T10:00:00.000Z', since = '2026-10-14T09:00:00.000Z';
const record = { binding: b, providerAccountId: 'provider', sourceId: 'source', ownerIdentity: { namespace: 'unipile.v1.whatsapp.im.phone_number', value: '+61412345678' } };
const account = { object: 'Account', id: 'provider', type: 'WHATSAPP', connection_params: { im: { phone_number: '+61412345678' } }, sources: [{ id: 'source', status: 'OK' }] };
const item = (id = 'm') => ({ object: 'Message', id, account_id: 'provider', chat_id: 'chat', timestamp: since, sender_id: 'peer', sender_attendee_id: 'attendee', is_sender: 0, is_event: 0, hidden: 0, deleted: 0 });
const event = { type: 'message' as const, reference: { binding: b, id: 'm' }, conversation: { binding: b, id: 'chat' }, direction: 'inbound' as const, sender: { kind: 'phone' as const, value: '+61400000000' }, occurredAt: since };
function fixture(pages: unknown[] = [{ object: 'MessageList', items: [item()], cursor: null }]) { let i = 0; const transport = { getAccount: vi.fn(async (id: string): Promise<UnipileHttpResult> => { void id; return { kind: 'success', status: 200, data: account }; }), list: vi.fn(async (input: HistoryListRequest): Promise<UnipileHttpResult> => { void input; return { kind: 'success', status: 200, data: pages[i++] }; }) }; const options = { record, transport, eventAccountInfo: { ownerProviderId: "own-provider", product: "whatsapp" as const }, resolveCurrent: vi.fn(async () => structuredClone(record)), initialSync: vi.fn(async () => ({ kind: 'provider_sync_success' as const, record: structuredClone(record), completedAt: '2026-10-14T08:00:00.000Z', evidenceId: 'authenticated-sync' })), normalize: vi.fn(async () => ({ kind: 'event' as const, event })), now: () => Date.parse(start) }; return { options, transport, source: () => createUnipileV1HistorySource(options), query: { binding: b, scope: 'all-replies', since, cursor: null, refresh: true } as EventQuery }; }
describe('exhaustive v1 history', () => {
    it('scans every cursor with inclusive bounds and records complete original-account coverage', async () => { const f = fixture([{ object: 'MessageList', items: [], cursor: 'next' }, { object: 'MessageList', items: [item()], cursor: null }]); const p = await f.source().read(f.query); expect(p.events).toEqual([event]); expect(p.coverage).toEqual({ binding: b, scope: 'all-replies', from: since, through: start, observedAt: start, complete: true, initialSyncComplete: true, invalidated: false }); expect(f.transport.list.mock.calls[1][0]).toMatchObject({ accountId: 'provider', cursor: 'next', after: '2026-10-14T08:59:59.999Z', before: '2026-10-14T10:00:00.001Z' }); });
    it('account OK and empty scan never invent initial sync', async () => { const f = fixture([{ object: 'MessageList', items: [], cursor: null }]); f.options.initialSync.mockResolvedValue(null as never); const p = await f.source().read(f.query); expect(p.coverage.complete).toBe(false); expect(p.coverage.initialSyncComplete).toBe(false); expect(p.wait?.code).toBe('incomplete'); });
    it('rejects a cursor cycle without claiming completeness', async () => { const f = fixture([{ object: 'MessageList', items: [], cursor: 'same' }, { object: 'MessageList', items: [], cursor: 'same' }]); await expect(f.source().read(f.query)).rejects.toThrow('History unavailable'); expect(f.transport.list).toHaveBeenCalledTimes(2); });
    it('withholds completeness when an inbound deleted or malformed item could hide a reply', async () => { const f = fixture([{ object: 'MessageList', items: [{ ...item(), deleted: 1 }], cursor: null }]); const p = await f.source().read(f.query); expect(p.coverage.invalidated).toBe(true); expect(p.coverage.complete).toBe(false); expect(f.options.normalize).not.toHaveBeenCalled(); });
    it('rejects changed recorded owner after source read', async () => { const f = fixture(); f.options.resolveCurrent.mockResolvedValueOnce(record).mockResolvedValue({ ...record, sourceId: 'wrong' }); await expect(f.source().read(f.query)).rejects.toThrow(); });
    it('rejects wrong account pages before normalization', async () => { const f = fixture([{ object: 'MessageList', items: [{ ...item(), account_id: 'other' }], cursor: null }]); await expect(f.source().read(f.query)).rejects.toThrow(); expect(f.options.normalize).not.toHaveBeenCalled(); });
    it('bounds stalled ports even when they ignore abort', async () => { const f = fixture(); f.options.resolveCurrent.mockImplementation(() => new Promise(() => { })); const source = createUnipileV1HistorySource({ ...f.options, deadlineMs: 10 }); await expect(source.read(f.query)).rejects.toThrow(); expect(f.transport.getAccount).not.toHaveBeenCalled(); });
    it('non-refresh input cannot certify freshness', async () => { const f = fixture(); const p = await f.source().read({ ...f.query, refresh: false }); expect(p.coverage.complete).toBe(false); });
});
it('rejects nested binding accessors without invoking them or performing I/O', async () => { const f = fixture(); let reads = 0; const wrong = { ...b }; Object.defineProperty(wrong, 'generation', { enumerable: true, get() { reads++; return 1; } }); await expect(f.source().read({ ...f.query, binding: wrong })).rejects.toThrow(); expect(reads).toBe(0); expect(f.transport.getAccount).not.toHaveBeenCalled(); });
it('Gmail exhaustive fresh scan establishes service query baseline without claiming unsupported provider-global initial sync', async () => {
    const f = fixture([{ object: 'EmailList', items: [], cursor: null }]), mailBinding = { ...b, channel: 'email' as const, platform: 'gmail' as const }, mailRecord = { ...record, binding: mailBinding, ownerIdentity: { namespace: 'unipile.v1.google.mail.id', value: 'opaque-mail-owner' } };
    const options = { ...f.options, record: mailRecord, resolveCurrent: async () => mailRecord, initialSync: async () => null, transport: { ...f.transport, getAccount: vi.fn(async () => ({ kind: 'success' as const, status: 200, data: { object: 'Account', id: 'provider', type: 'GOOGLE_OAUTH', connection_params: { mail: { id: 'opaque-mail-owner' } }, sources: [{ id: 'source', status: 'OK' }] } })) } };
    const page = await createUnipileV1HistorySource(options).read({ ...f.query, binding: mailBinding });
    expect(page.coverage).toMatchObject({ complete: true, initialSyncComplete: true });
    expect((page as typeof page & {
        provenance: {
            initialSyncEvidence: {
                kind: string;
                query: {
                    scope: string;
                    from: string;
                    through: string;
                };
            };
        };
    }).provenance.initialSyncEvidence).toMatchObject({ kind: 'query_baseline', query: { scope: 'all-replies', from: since, through: start } });
});
it('multiple social sources cannot borrow one source sync proof to certify mixed account-wide history', async () => { const f = fixture(); f.transport.getAccount.mockResolvedValue({ kind: 'success', status: 200, data: { ...account, sources: [{ id: 'source', status: 'OK' }, { id: 'unproven-premium-source', status: 'OK' }] } }); await expect(f.source().read(f.query)).rejects.toThrow('History unavailable'); expect(f.transport.list).not.toHaveBeenCalled(); });
