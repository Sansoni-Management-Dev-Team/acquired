import { expect, it, vi } from 'vitest';
import { createDispatchCoordinator, type DispatchCoordinatorOptions, type DispatchJournalPort, type DispatchRecord } from './dispatch';
import type { ConnectionBinding, DeliveryOutcome, MessagingAdapter } from '../../contracts/src';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const binding: ConnectionBinding = { applicationId: 'fixture', tenantId: 'tenant', ownerId: 'owner', connectionId: 'connection', accountId: 'account', generation: 1, channel: 'email', platform: 'gmail', backend: 'unipile' };
function fixture(b = binding) {
    const original = { snapshot: { binding: b, key: 'original', operation: 'message' as const, payloadDigest: 'a'.repeat(64) }, recipient: { kind: 'email' as const, value: 'recipient@example.test' }, state: 'unknown' as const, outcome: { status: 'unknown' as const } };
    const accepted: DeliveryOutcome = { status: 'submitted', receipt: { message: { binding: b, id: 'actual-email-id' }, recipient: original.recipient, submittedAt: '2026-01-01T00:00:00.000Z' } };
    const reconcile = vi.fn<DispatchJournalPort['reconcile']>(async ({ record, outcome }) => ({ ...record, message: accepted.status === 'submitted' && 'message' in accepted.receipt ? accepted.receipt.message : undefined, state: 'completed', outcome } as DispatchRecord));
    const journal = { get: vi.fn(async () => structuredClone(original)), reconcile, claim: vi.fn(), beginDispatch: vi.fn(), complete: vi.fn() } as unknown as DispatchJournalPort;
    const adapter: MessagingAdapter = { ready: vi.fn(), submit: vi.fn(), lookup: vi.fn() };
    const recovery = vi.fn<NonNullable<DispatchCoordinatorOptions['recoverUnknownEmail']>>(async () => structuredClone(accepted));
    return { original, accepted, journal, adapter, recovery, reconcile, lookup: { snapshot: original.snapshot, expectedRecipient: original.recipient } };
}
it('reconciles a trusted original tracking association without caller-nominated ID, send or quota admission', async () => {
    const f = fixture(), coordinator = createDispatchCoordinator(binding, f.adapter, f.journal, { recoverUnknownEmail: f.recovery });
    expect(await coordinator.lookup(f.lookup)).toEqual(f.accepted);
    expect(f.recovery).toHaveBeenCalledWith(f.original, expect.any(AbortSignal));
    expect(f.reconcile).toHaveBeenCalledWith({ record: f.original, outcome: f.accepted });
    expect(f.adapter.lookup).not.toHaveBeenCalled();
    expect(f.adapter.submit).not.toHaveBeenCalled();
    expect(f.journal.beginDispatch).not.toHaveBeenCalled();
});
it('keeps unknown without explicitly configured trusted recovery', async () => { const f = fixture(); expect(await createDispatchCoordinator(binding, f.adapter, f.journal).lookup(f.lookup)).toEqual({ status: 'unknown' }); expect(f.reconcile).not.toHaveBeenCalled(); });
it('recovers an original dispatching record after ACK/association persisted but completion crashed', async () => {
    const f = fixture(), crashed: DispatchRecord = { snapshot: f.original.snapshot, recipient: f.original.recipient, state: 'dispatching' };
    vi.mocked(f.journal.get).mockResolvedValue(crashed);
    expect(await createDispatchCoordinator(binding, f.adapter, f.journal, { recoverUnknownEmail: f.recovery }).lookup(f.lookup)).toEqual(f.accepted);
    expect(f.reconcile).toHaveBeenCalledWith({ record: crashed, outcome: f.accepted });
    expect(f.journal.beginDispatch).not.toHaveBeenCalled();
    expect(f.adapter.submit).not.toHaveBeenCalled();
});
it('keeps a dispatching crash unknown without the trusted original association reader', async () => {
    const f = fixture();
    vi.mocked(f.journal.get).mockResolvedValue({ snapshot: f.original.snapshot, recipient: f.original.recipient, state: 'dispatching' });
    expect(await createDispatchCoordinator(binding, f.adapter, f.journal).lookup(f.lookup)).toEqual({ status: 'unknown' });
    expect(f.adapter.lookup).not.toHaveBeenCalled();
    expect(f.reconcile).not.toHaveBeenCalled();
});
it('never uses a caller message proposal to activate tracking recovery', async () => { const f = fixture(); expect(await createDispatchCoordinator(binding, f.adapter, f.journal, { recoverUnknownEmail: f.recovery }).lookup({ ...f.lookup, message: { binding, id: 'caller-guess' } })).toEqual({ status: 'unknown' }); expect(f.recovery).not.toHaveBeenCalled(); });
it.each([{ channel: 'email', platform: 'gmail', backend: 'direct' }, { channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile' }] as const)('keeps other backend/channel unknown %#', async (change) => {
    const b = { ...binding, ...change }, f = fixture(b);
    if (b.channel === 'whatsapp')
        f.original.recipient = { kind: 'phone', value: '+61400000000' } as never;
    expect(await createDispatchCoordinator(b, f.adapter, f.journal, { recoverUnknownEmail: f.recovery }).lookup({ snapshot: f.original.snapshot })).toEqual({ status: 'unknown' });
    expect(f.recovery).not.toHaveBeenCalled();
});
it.each(['missing', 'foreign-account', 'wrong-recipient', 'action', 'unknown'] as const)('does not reconcile invalid or missing recovery (%s)', async (kind) => {
    const f = fixture();
    const value = structuredClone(f.accepted) as Extract<DeliveryOutcome, {
        status: 'submitted';
    }>;
    if (kind === 'foreign-account' && 'message' in value.receipt)
        value.receipt.message.binding.accountId = 'other';
    if (kind === 'wrong-recipient')
        value.receipt.recipient.value = 'other@example.test';
    if (kind === 'action')
        value.receipt = { operation: { binding, id: 'tracking-not-message' }, recipient: f.original.recipient };
    f.recovery.mockImplementation(async () => kind === 'missing' ? null : kind === 'unknown' ? { status: 'unknown' } : value);
    expect(await createDispatchCoordinator(binding, f.adapter, f.journal, { recoverUnknownEmail: f.recovery }).lookup(f.lookup)).toEqual({ status: 'unknown' });
    expect(f.reconcile).not.toHaveBeenCalled();
});
it('a failed durable reconciliation remains unknown', async () => { const f = fixture(); f.reconcile.mockRejectedValue(Error('synthetic uncertain commit')); expect(await createDispatchCoordinator(binding, f.adapter, f.journal, { recoverUnknownEmail: f.recovery }).lookup(f.lookup)).toEqual({ status: 'unknown' }); });
it('callback mutation cannot move the original journal operation', async () => { const f = fixture(); const recover = async (record: DispatchRecord) => { record.snapshot.key = 'different'; record.recipient.value = 'other@example.test'; return f.accepted; }; expect(await createDispatchCoordinator(binding, f.adapter, f.journal, { recoverUnknownEmail: recover }).lookup(f.lookup)).toEqual(f.accepted); expect(f.reconcile.mock.calls[0][0].record).toEqual(f.original); });
it('bounds a stalled reader and never reconciles its late result', async () => { const f = fixture(); let done!: (v: DeliveryOutcome) => void, signal: AbortSignal | undefined; const read = (_r: DispatchRecord, s: AbortSignal) => { signal = s; return new Promise<DeliveryOutcome>(resolve => done = resolve); }; expect(await createDispatchCoordinator(binding, f.adapter, f.journal, { recoverUnknownEmail: read, recoveryTimeoutMs: 10 }).lookup(f.lookup)).toEqual({ status: 'unknown' }); expect(signal?.aborted).toBe(true); done(f.accepted); await Promise.resolve(); expect(f.reconcile).not.toHaveBeenCalled(); });
it('checks monotonic time after a synchronously stalled reader before reconciliation', async () => { const f = fixture(); const read = async () => { const end = performance.now() + 15; while (performance.now() < end) { } return f.accepted; }; expect(await createDispatchCoordinator(binding, f.adapter, f.journal, { recoverUnknownEmail: read, recoveryTimeoutMs: 5 }).lookup(f.lookup)).toEqual({ status: 'unknown' }); expect(f.reconcile).not.toHaveBeenCalled(); });
it('native Node observes malformed promised receipt fields without an unhandled rejection', () => {
    const script = `const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict');require.extensions['.ts']=(m,p)=>m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,p);const {createDispatchCoordinator}=require(process.argv[1]);const binding=${JSON.stringify(binding)},record={snapshot:{binding,key:'original',operation:'message',payloadDigest:'a'.repeat(64)},recipient:{kind:'email',value:'recipient@example.test'},state:'unknown',outcome:{status:'unknown'}};let reconciles=0;const forbidden=async()=>{throw Error('Unexpected mutation');};const journal={get:async()=>record,reconcile:async()=>{reconciles++;throw Error('Unexpected reconciliation');},claim:forbidden,beginDispatch:forbidden,complete:forbidden};createDispatchCoordinator(binding,{ready:forbidden,submit:forbidden,lookup:forbidden},journal,{recoverUnknownEmail:async()=>({status:'submitted',receipt:{message:{binding,id:Promise.reject(Error('synthetic malformed result'))},recipient:record.recipient}})}).lookup({snapshot:record.snapshot}).then(result=>{assert.deepEqual(result,{status:'unknown'});assert.equal(reconciles,0);setTimeout(()=>process.stdout.write('observed'),5);}).catch(()=>process.exitCode=1);`;
    const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '-e', script, fileURLToPath(new URL('./dispatch.ts', import.meta.url))], { encoding: 'utf8', timeout: 10000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('observed');
});
