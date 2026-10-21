import { expect, it, vi } from 'vitest';
import { consumeHeldApplicationPermit, type AdmissionChallenge, type ServiceAdmissionReceipt } from './send-admission';
const record = { snapshot: { binding: { applicationId: 'acquire', tenantId: 'org', ownerId: 'owner', connectionId: 'connection', accountId: 'account', generation: 1, channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile' }, key: 'epoch-1', operation: 'message', payloadDigest: 'a'.repeat(64) }, recipient: { kind: 'phone', value: '+15550000000' }, state: 'claimed' } as const;
const challenge: AdmissionChallenge = { record, claimToken: 'claim', serviceRevision: '4' };
const receipt: ServiceAdmissionReceipt = { permitId: 'permit', intentDigest: 'b'.repeat(64), journalId: 'journal', admissionId: 'admission', snapshot: record.snapshot, fencingToken: '1', serviceRevision: '4' };
it('holds application authority through service COMMIT and definite app COMMIT before admitted', async () => {
    const order: string[] = [], abort = vi.fn(async () => { });
    const application = { open: async () => { order.push('app-held'); return { kind: 'held' as const, permit: { permitId: 'permit', intentDigest: 'b'.repeat(64), abort, coverageScopes: [{ binding: record.snapshot.binding, recipient: record.recipient, scopeDigest: 'c'.repeat(64), requiredSince: '2026-10-01T00:00:00.000Z' }], commit: async () => { order.push('app-commit'); return 'committed' as const; } } }; } };
    const result = await consumeHeldApplicationPermit(application, challenge, async () => { order.push('service-commit'); return { receipt, record: { ...record, state: 'dispatching' } }; }, new AbortController().signal);
    expect(result.kind).toBe('admitted');
    expect(order).toEqual(['app-held', 'service-commit', 'app-commit']);
    expect(abort).toHaveBeenCalledOnce();
});
it('never calls service on blocked current app policy', async () => {
    const service = vi.fn();
    expect(await consumeHeldApplicationPermit({ open: async () => ({ kind: 'blocked', outcome: { status: 'review', code: 'forbidden' } }) }, challenge, service, new AbortController().signal)).toEqual({ kind: 'blocked', outcome: { status: 'review', code: 'forbidden' } });
    expect(service).not.toHaveBeenCalled();
});
it('lost app commit returns uncertain and never invents admitted authority', async () => {
    const abort = vi.fn(async () => { }), commit = vi.fn(async () => { throw Error('private lost COMMIT'); });
    const result = await consumeHeldApplicationPermit({ open: async () => ({ kind: 'held', permit: { permitId: 'permit', intentDigest: 'b'.repeat(64), abort, coverageScopes: [{ binding: record.snapshot.binding, recipient: record.recipient, scopeDigest: 'c'.repeat(64), requiredSince: '2026-10-01T00:00:00.000Z' }], commit } }) }, challenge, async () => ({ receipt, record: { ...record, state: 'dispatching' } }), new AbortController().signal);
    expect(result).toEqual({ kind: 'uncertain' });
    expect(commit).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledOnce();
});
it('never echoes undeclared content from an authority denial', async () => {
    const result = await consumeHeldApplicationPermit({ open: async () => ({ kind: 'blocked', outcome: { status: 'review', code: 'forbidden', privateContent: 'synthetic-private-content' } }) } as unknown as import('./send-admission').HeldApplicationAdmission, challenge, vi.fn(), new AbortController().signal);
    expect(result).toEqual({ kind: 'uncertain' });
    expect(JSON.stringify(result)).not.toContain('synthetic-private-content');
});
it('cannot authorize a changed recipient from service acknowledgement', async () => {
    const commit = vi.fn(async () => 'committed' as const), abort = vi.fn(async () => { });
    const app = { open: async () => ({ kind: 'held' as const, permit: { permitId: 'permit', intentDigest: 'b'.repeat(64), coverageScopes: [{ binding: record.snapshot.binding, recipient: record.recipient, scopeDigest: 'c'.repeat(64), requiredSince: '2026-10-01T00:00:00.000Z' }], commit, abort } }) };
    const changed = { ...record, state: 'dispatching' as const, recipient: { kind: 'phone' as const, value: '+15551111111' } };
    expect(await consumeHeldApplicationPermit(app, challenge, async () => ({ receipt, record: changed }), new AbortController().signal)).toEqual({ kind: 'uncertain' });
    expect(commit).not.toHaveBeenCalled();
});
it('distinguishes swallowed permission-open, held-permit, service and application commit boundaries without changing denial',async()=>{
 for(const boundary of ['open','permit','service_commit','app_commit']as const){const diagnostic=vi.fn(),abort=vi.fn(async()=>{}),privateError=Object.assign(Error('private body/key'),{code:'40001'}),commit=vi.fn(async()=>{if(boundary==='app_commit')throw privateError;return'committed'as const;}),service=vi.fn(async()=>{if(boundary==='service_commit')throw privateError;return{receipt,record:{...record,state:'dispatching'as const}};}),application={open:async()=>{if(boundary==='open')throw privateError;return{kind:'held'as const,permit:{permitId:'permit',intentDigest:boundary==='permit'?'bad':'b'.repeat(64),coverageScopes:[{binding:record.snapshot.binding,recipient:record.recipient,scopeDigest:'c'.repeat(64),requiredSince:'2026-10-01T00:00:00.000Z'}],abort,commit}};}};
 expect(await consumeHeldApplicationPermit(application,challenge,service,new AbortController().signal,diagnostic)).toEqual({kind:'uncertain'});expect(diagnostic.mock.calls.some(([v])=>v.stage==='admission.'+boundary)).toBe(true);expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('private');if(['open','permit'].includes(boundary))expect(service).not.toHaveBeenCalled();}
});
