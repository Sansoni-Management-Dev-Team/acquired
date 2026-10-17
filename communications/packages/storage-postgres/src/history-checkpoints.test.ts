import { it, expect, vi } from 'vitest';
import type { SqlPool, SqlResult } from './webhook-repository';
import { createPostgresHistoryCheckpoints } from './history-checkpoints';
import { HistoryCheckpointCodec } from './history-checkpoint-codec';
import { EventCodec } from '../../core/src/event-codec';
import type { ConnectionBinding } from '../../contracts/src';
const binding: ConnectionBinding = { applicationId: 'a', tenantId: 't', ownerId: 'o', connectionId: 'c', accountId: 'p', generation: 1, channel: 'email', platform: 'gmail', backend: 'unipile' };
const at = '2026-10-14T09:00:00.000Z', query = { binding, scope: 'all', since: at, cursor: null, refresh: true };
const codec = new HistoryCheckpointCodec({ activeVersion: 'v1', keys: [{ version: 'v1', encryptionKey: Buffer.alloc(32, 1), digestKey: Buffer.alloc(32, 2) }] }), eventCodec = new EventCodec({ activeVersion: 'v1', keys: [{ version: 'v1', encryptionKey: Buffer.alloc(32, 3), digestKey: Buffer.alloc(32, 4) }] });
function fixture() {
    const statements: string[] = [];
    const client = { release: vi.fn(), query: vi.fn(async (sql: string): Promise<SqlResult> => {
            statements.push(sql);
            if(sql.includes('AS history_replies_pending'))return{rows:[{history_replies_pending:false}]};
            if (sql.includes('pg_roles'))
                return { rows: [{ role: 'communications_control', rolsuper: false, rolbypassrls: false, rolcanlogin: false }] };
            if (sql.includes('advance_reply_barrier'))
                return { rows: [{ revision: '4' }] };
            if (sql.includes('lock_reply_barrier'))
                return { rows: [{ revision: '3' }] };
            if (sql.includes('physical_valid'))
                return { rows: [{ physical_valid: true }] };
            if (sql.includes('JOIN communications.access_grants'))
                return { rows: [{ valid: true }] };
            if (sql.includes("SET state='processed'"))
                return { rows: [{ id: 'a'.repeat(64) }] };
            if (sql.includes('INSERT INTO communications.history_refreshes'))
                return { rows: [{ started_at: at }] };
            if (sql.includes('grant_valid'))
                return { rows: [{ grant_valid: true }] };
            return { rows: [], rowCount: 1 };
        }) };
    const pool = { connect: vi.fn(async () => client) };
    return { statements, client, pool, options: { pool: pool as unknown as SqlPool, binding, record: { binding, providerAccountId: 'provider', sourceId: 'source', ownerIdentity: { namespace: 'unipile.v1.google.mail.id', value: 'owner-mail' } }, integrationId: 'integration', providerConfigurationReference: 'config', subscriberId: 'subscriber', codec, eventCodec } };
}
it('begins durable exact-scope scan only after role and tenant/current-generation fences', async () => { const f = fixture(); const repo = createPostgresHistoryCheckpoints(f.options); const ticket = await repo.begin(query); expect(ticket).toMatchObject({ binding, scope: 'all', since: at, startedAt: at, revision: '3' }); expect(ticket?.token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(f.statements.findIndex(q => q.includes('lock_reply_barrier'))).toBeLessThan(f.statements.findIndex(q => q.includes('JOIN communications.access_grants'))); expect(f.statements.at(-1)).toBe('COMMIT'); expect(f.client.release).toHaveBeenCalledWith(expect.any(Error)); });
it('never returns refresh ticket after ambiguous COMMIT and physically retires driver', async () => {
    const f = fixture(), original = f.client.query.getMockImplementation()!;
    f.client.query.mockImplementation(async (sql) => {
        if (sql === 'COMMIT')
            throw Error('private');
        return original(sql);
    });
    const repo = createPostgresHistoryCheckpoints(f.options);
    await expect(repo.begin(query)).rejects.toThrow('History storage unavailable');
    expect(f.client.release).toHaveBeenCalledTimes(1);
    expect(f.client.release).toHaveBeenCalledWith(expect.any(Error));
});
it('scope digest cannot cross owner/generation or cleartext scope', () => { expect(codec.digest(binding, 'all')).not.toBe(codec.digest({ ...binding, generation: 2 }, 'all')); expect(codec.digest(binding, 'all')).not.toBe(codec.digest(binding, 'other')); const sealed = codec.seal(binding, 'all', { private: 'secret' }); expect(JSON.stringify(sealed)).not.toContain('secret'); expect(codec.open(binding, 'all', sealed)).toEqual({ private: 'secret' }); expect(() => codec.open(binding, 'other', sealed)).toThrow(); });
const record = { binding, providerAccountId: 'provider', sourceId: 'source', ownerIdentity: { namespace: 'unipile.v1.google.mail.id', value: 'owner-mail' } };
const proof = { providerAccountId: 'provider', sourceId: 'source', initialSyncEvidence: { kind: 'query_baseline' as const, record, evidenceId: 'authenticated-sync', completedAt: at, query: { scope: 'all', from: at, through: at } }, outbound: [], exhausted: true, refresh: true };
const event = { type: 'message' as const, reference: { binding, id: 'mail' }, direction: 'inbound' as const, sender: { kind: 'email' as const, value: 'peer@example.com' }, occurredAt: at };
const completePage = { events: [event], nextCursor: null, coverage: { binding, scope: 'all', from: at, through: at, observedAt: at, complete: true, initialSyncComplete: true, invalidated: false }, provenance: proof };
async function committing() {
    const f = fixture(), repo = createPostgresHistoryCheckpoints(f.options), ticket = (await repo.begin(query))!;
    const base = f.client.query.getMockImplementation()!;
    f.client.query.mockImplementation(async (sql) => {
        if (sql.includes('SELECT token_hash'))
            return { rows: [{ token_hash: await import('node:crypto').then(({ createHash }) => createHash('sha256').update(JSON.stringify(ticket.token)).digest('hex')), required_since: at, capture_revision: '3', started_at: at, alive: true, observed_valid: true }] };
        if (sql.includes('INSERT INTO communications.events'))
            return { rows: [{ id: '1' }] };
        return base(sql);
    });
    return { ...f, repo, ticket };
}
it('commits normal reply events/outbox before complete coverage and definite COMMIT', async () => { const f = await committing(); const result = await f.repo.commit(f.ticket, completePage); expect(result.coverage.complete).toBe(true); const outbox = f.statements.findIndex(s => s.includes('INSERT INTO communications.event_outbox')), coverage = f.statements.findIndex(s => s.includes('SET encrypted_cursor')); expect(outbox).toBeGreaterThan(0); expect(outbox).toBeLessThan(coverage); expect(f.statements.at(-1)).toBe('COMMIT'); });
it('tenant revision change during refresh prevents complete coverage', async () => { const f = await committing(), base = f.client.query.getMockImplementation()!; f.client.query.mockImplementation(async (sql) => sql.includes('lock_reply_barrier') ? { rows: [{ revision: '4' }] } : base(sql)); expect((await f.repo.commit(f.ticket, completePage)).coverage).toMatchObject({ complete: false, invalidated: true }); });
it('event/outbox failure cannot publish complete coverage or COMMIT', async () => {
    const f = await committing(), base = f.client.query.getMockImplementation()!;
    f.statements.length = 0;
    f.client.query.mockImplementation(async (sql) => {
        if (sql.includes('event_outbox'))
            throw Error('private');
        return base(sql);
    });
    await expect(f.repo.commit(f.ticket, completePage)).rejects.toThrow();
    expect(f.statements).not.toContain('COMMIT');
    expect(f.statements.some(s => s.includes('SET encrypted_cursor'))).toBe(false);
});
it('complete claimed page without original-source/sync provenance never reaches SQL', async () => { const f = await committing(); f.pool.connect.mockClear(); const unproved = { events: completePage.events, nextCursor: completePage.nextCursor, coverage: completePage.coverage }; await expect(f.repo.commit(f.ticket, unproved)).rejects.toThrow(); expect(f.pool.connect).not.toHaveBeenCalled(); });
it('out-of-window normalized event never advances coverage', async () => { const f = await committing(); f.statements.length = 0; await expect(f.repo.commit(f.ticket, { ...completePage, events: [{ ...event, occurredAt: '2026-10-14T08:59:59.999Z' }] })).rejects.toThrow(); expect(f.statements).not.toContain('COMMIT'); });
it('natural expiry before refresh COMMIT withholds ticket', async () => { const f = fixture(), base = f.client.query.getMockImplementation()!; f.client.query.mockImplementation(async (sql) => sql.includes('grant_valid') ? { rows: [{ grant_valid: false }] } : base(sql)); await expect(createPostgresHistoryCheckpoints(f.options).begin(query)).rejects.toThrow(); expect(f.statements).not.toContain('COMMIT'); });
it('semantic collision creates separate encrypted review+outbox as well as latch before withholding coverage', async () => {
    const f = await committing(), base = f.client.query.getMockImplementation()!, { createHash } = await import('node:crypto'), hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex'), vector = [binding.applicationId, binding.tenantId, binding.ownerId, binding.connectionId, binding.accountId, binding.generation, binding.channel, binding.platform, binding.backend], oldEvent = { ...event, sender: { kind: 'email' as const, value: 'different@example.com' } }, key = hash(['communications.reply.event.v1', vector, null, 'mail']), fingerprint = hash(['communications.reply.content.v1', vector, 'mail', null, 'inbound', 'email', 'different@example.com', at]), sealed = eventCodec.encode({ binding, key }, { outcome: { kind: 'event', event: oldEvent, eventKey: key, fingerprint }, fingerprint, receivedAt: at });
    let inserts = 0;
    f.client.query.mockImplementation(async (sql) => {
        if (sql.includes('INSERT INTO communications.events')) {
            inserts++;
            return { rows: inserts === 1 ? [] : [{ id: '2' }] };
        }
        if (sql.includes('SELECT id::text,encrypted_event'))
            return { rows: [{ id: '1', encrypted_event: JSON.stringify(sealed), key_version: sealed.keyVersion }] };
        return base(sql);
    });
    f.statements.length = 0;
    expect((await f.repo.commit(f.ticket, completePage)).coverage).toMatchObject({ complete: false, invalidated: true });
    expect(inserts).toBe(2);
    expect(f.statements.filter(s => s.includes('INSERT INTO communications.event_outbox'))).toHaveLength(2);
    expect(f.statements.some(s => s.includes('reply_review_latches'))).toBe(true);
});
it('held admission coverage malformed revision is sanitized rather than exposing stored private error data', async () => {
    const f = fixture(), repo = createPostgresHistoryCheckpoints(f.options), base = f.client.query.getMockImplementation()!;
    f.client.query.mockImplementation(async (sql) => {
        if (sql.includes('FROM communications.event_cursors ec JOIN'))
            return { rows: [{ complete: true, initial_sync_complete: true, invalidated: false, fresh: true, finished_at: at, digest_key_version: 'v1', capture_revision: 'private-malformed-revision', finished_revision: '3' }] };
        return base(sql);
    });
    await expect(repo.assertCoverage(f.client as never, { binding, scopeDigest: repo.scopeDigest('all'), requiredSince: at, maxAgeSeconds: 300, serviceRevision: '3' })).rejects.toThrow('History storage unavailable');
});
it('held service admission verifies decrypted original source/scope proof and DB-clock metadata within existing TX', async () => { const f = fixture(), repo = createPostgresHistoryCheckpoints(f.options), dg = repo.scopeDigest('all'), coverage = completePage.coverage, payload = { coverage, provenance: proof, scopeKeyVersion: 'v1', captureRevision: '2', finishedRevision: '3' }, sealed = codec.seal(binding, dg, payload), base = f.client.query.getMockImplementation()!; f.client.query.mockImplementation(async (sql) => sql.includes('FROM communications.event_cursors ec JOIN') ? { rows: [{ encrypted_cursor: JSON.stringify(sealed), cursor_key_version: 'v1', coverage_from: at, coverage_through: at, observed_at: at, complete: true, initial_sync_complete: true, invalidated: false, digest_key_version: 'v1', required_since: at, started_at: at, finished_at: at, capture_revision: '2', finished_revision: '3', fresh: true }] } : base(sql)); await expect(repo.assertCoverage(f.client as never, { binding, scopeDigest: dg, requiredSince: at, maxAgeSeconds: 300, serviceRevision: '3' })).resolves.toBeUndefined(); expect(f.pool.connect).not.toHaveBeenCalled(); expect(f.statements).not.toContain('COMMIT'); });
it('held admission refuses untouched complete flags without verified history proof', async () => { const f = fixture(), repo = createPostgresHistoryCheckpoints(f.options); await expect(repo.assertCoverage(f.client as never, { binding, scopeDigest: repo.scopeDigest('all'), requiredSince: at, maxAgeSeconds: 300, serviceRevision: '3' })).rejects.toThrow('History storage unavailable'); });
it('records DB-observed SYNC_SUCCESS while preserving the distinct authenticated ingress timestamp', async () => {
    const f = fixture(), socialBinding = { ...binding, channel: 'linkedin' as const, platform: 'linkedin' as const }, socialRecord = { ...record, binding: socialBinding, ownerIdentity: { namespace: 'unipile.v1.linkedin.im.id', value: 'owner' } }, rawBody = Buffer.from(JSON.stringify({ AccountStatus: { account_id: 'provider', account_type: 'LINKEDIN', message: 'SYNC_SUCCESS', product: 'classic' } })), claim = { binding: socialBinding, key: 'a'.repeat(64), rawBody, receivedAt: at, token: 'b'.repeat(43) }, captureCodec = { encode: vi.fn(), decode: vi.fn(() => ({ ...claim })), digest: vi.fn(() => 'c'.repeat(64)) }, base = f.client.query.getMockImplementation()!;
    f.client.query.mockImplementation(async (sql) => {
        if (sql.includes('JOIN communications.webhook_receipt_routes'))
            return { rows: [{ encrypted_payload: JSON.stringify({ keyVersion: 'capture-v1' }), key_version: 'capture-v1', payload_digest: 'c'.repeat(64), received_at: '2026-10-14T09:00:01.000Z', claim_valid: true, alive: true }] };
        if (sql.includes('INSERT INTO communications.history_initial_sync'))
            return { rows: [{ webhook_inbox_id: claim.key }] };
        return base(sql);
    });
    const repo = createPostgresHistoryCheckpoints({ ...f.options, binding: socialBinding, record: socialRecord, captureCodec, expectedSyncProduct: 'classic' });
    expect(await repo.recordInitialSync(claim)).toEqual({ status: 'recorded' });
    expect(f.statements.some(s => s.includes("SET state='processed'"))).toBe(true);
    expect(f.statements.at(-1)).toBe('COMMIT');
});
it('wrong-channel admission recipient cannot silently clear manual-outbound checks', async () => { const f = fixture(), repo = createPostgresHistoryCheckpoints(f.options), dg = repo.scopeDigest('all'), coverage = completePage.coverage, payload = { coverage, provenance: proof, scopeKeyVersion: 'v1', captureRevision: '2', finishedRevision: '3' }, sealed = codec.seal(binding, dg, payload), base = f.client.query.getMockImplementation()!; f.client.query.mockImplementation(async (sql) => sql.includes('FROM communications.event_cursors ec JOIN') ? { rows: [{ encrypted_cursor: JSON.stringify(sealed), cursor_key_version: 'v1', coverage_from: at, coverage_through: at, observed_at: at, complete: true, initial_sync_complete: true, invalidated: false, digest_key_version: 'v1', required_since: at, started_at: at, finished_at: at, capture_revision: '2', finished_revision: '3', fresh: true }] } : base(sql)); await expect(repo.assertCoverage(f.client as never, { binding, scopeDigest: dg, requiredSince: at, maxAgeSeconds: 300, serviceRevision: '3', recipient: { kind: 'phone', value: '+61400000000' } })).rejects.toThrow('History storage unavailable'); });
function admissionWithOutbound(recipient: string, recorded?: boolean) { const f = fixture(), outbound = { binding, reference: { binding, id: 'sent-mail' }, recipient: { kind: 'email' as const, value: recipient }, occurredAt: at }, verify = vi.fn(async () => recorded === true), repo = createPostgresHistoryCheckpoints({ ...f.options, isRecordedOutbound: verify }), dg = repo.scopeDigest('all'), sealed = codec.seal(binding, dg, { coverage: completePage.coverage, provenance: { ...proof, outbound: [outbound] }, scopeKeyVersion: 'v1', captureRevision: '2', finishedRevision: '3' }), base = f.client.query.getMockImplementation()!; f.client.query.mockImplementation(async (sql) => sql.includes('FROM communications.event_cursors ec JOIN') ? { rows: [{ encrypted_cursor: JSON.stringify(sealed), cursor_key_version: 'v1', coverage_from: at, coverage_through: at, observed_at: at, complete: true, initial_sync_complete: true, invalidated: false, digest_key_version: 'v1', required_since: at, started_at: at, finished_at: at, capture_revision: '2', finished_revision: '3', fresh: true }] } : base(sql)); return { ...f, repo, verify, outbound, input: { binding, scopeDigest: dg, requiredSince: at, maxAgeSeconds: 300, serviceRevision: '3', recipient: { kind: 'email' as const, value: 'peer@example.com' } } }; }
it('unrelated personal outreach does not block target recipient or invoke association verifier', async () => { const f = admissionWithOutbound('other@example.com', false); await expect(f.repo.assertCoverage(f.client as never, f.input)).resolves.toBeUndefined(); expect(f.verify).not.toHaveBeenCalled(); });
it('matching unrecorded outbound blocks admission despite complete reply coverage', async () => { const f = admissionWithOutbound('peer@example.com', false); await expect(f.repo.assertCoverage(f.client as never, f.input)).rejects.toThrow('History storage unavailable'); expect(f.verify).toHaveBeenCalledWith(f.client, f.outbound); });
it('verified original-journal matching outbound can pass within held transaction', async () => { const f = admissionWithOutbound('peer@example.com', true); await expect(f.repo.assertCoverage(f.client as never, f.input)).resolves.toBeUndefined(); expect(f.verify).toHaveBeenCalledWith(f.client, f.outbound); expect(f.statements).not.toContain('COMMIT'); });
it('holds service coverage/gates until application projection revalidation and definite callback completion', async () => { const f = admissionWithOutbound('other@example.com', false), base = f.client.query.getMockImplementation()!; f.client.query.mockImplementation(async (sql) => sql.includes('assert_dispatch_reply_barrier') ? { rows: [{ revision: '3' }] } : sql.includes('SELECT coverage_from,coverage_through,observed_at FROM') ? { rows: [{ coverage_from: at, coverage_through: at, observed_at: at }] } : base(sql)); let alive: (() => Promise<void>) | undefined; expect(await f.repo.withCoverage(query, async (snapshot) => { expect(f.statements).not.toContain('COMMIT'); expect(snapshot.coverage.complete).toBe(true); alive = snapshot.revalidate; await snapshot.revalidate(); return 'app-definitely-committed'; })).toBe('app-definitely-committed'); expect(f.statements.at(-1)).toBe('COMMIT'); await expect(alive!()).rejects.toThrow(); });
it('scope HMAC version can remain pinned when checkpoint encryption rotates', () => { const f = fixture(), rotated = new HistoryCheckpointCodec({ activeVersion: 'v2', keys: [{ version: 'v1', encryptionKey: Buffer.alloc(32, 1), digestKey: Buffer.alloc(32, 2) }, { version: 'v2', encryptionKey: Buffer.alloc(32, 5), digestKey: Buffer.alloc(32, 6) }] }); const repo = createPostgresHistoryCheckpoints({ ...f.options, codec: rotated, scopeKeyVersion: 'v1' }); expect(repo.scopeDigest('all')).toBe(codec.digest(binding, 'all')); expect(rotated.seal(binding, repo.scopeDigest('all'), {}).keyVersion).toBe('v2'); });
it('outbound provenance outside the scanned window cannot commit complete coverage', async () => { const f = await committing(); f.pool.connect.mockClear(); const outsidePage = { ...completePage, provenance: { ...proof, outbound: [{ binding, reference: { binding, id: 'manual' }, recipient: { kind: 'email' as const, value: 'peer@example.com' }, occurredAt: '2026-10-14T09:00:00.001Z' }] } }; await expect(f.repo.commit(f.ticket, outsidePage)).rejects.toThrow(); expect(f.pool.connect).not.toHaveBeenCalled(); });
