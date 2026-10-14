import { expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createConnectionLifecycleCoordinator, type RecordedLifecycleConnection, type ConnectionLifecycleOptions } from './connection-lifecycle';
const binding = { applicationId: 'app', tenantId: 'tenant', ownerId: 'owner', connectionId: 'connection', accountId: 'physical', generation: 2, channel: 'linkedin' as const, platform: 'linkedin' as const, backend: 'unipile' as const };
const recorded: RecordedLifecycleConnection = { binding, providerAccountId: 'provider-account', sourceId: 'classic', ownerIdentity: { namespace: 'provider.owner', value: 'verified-opaque-id' } };
function fixture(overrides: Partial<ConnectionLifecycleOptions> = {}) {
    const resolve = vi.fn().mockImplementation(async () => structuredClone(recorded));
    const get = vi.fn().mockImplementation(async () => ({ status: 'observed', observation: { ...structuredClone(recorded), status: 'connected' } }));
    const disconnect = vi.fn().mockResolvedValue({ status: 'disconnected' });
    const prepare = vi.fn().mockImplementation(async (record, key) => ({ status: 'prepared', ticket: { record: structuredClone(record), operationKey: key, token: 'a'.repeat(43) } }));
    const finish = vi.fn().mockResolvedValue({ status: 'recorded' });
    const api = createConnectionLifecycleCoordinator({ binding, resolveCurrent: resolve, provider: { get, disconnect }, prepareDisconnect: prepare, finishDisconnect: finish, ...overrides });
    return { api, resolve, get, disconnect, prepare, finish };
}
it('reads status only through exact current owner and rechecks authority afterward', async () => {
    const f = fixture();
    expect(await f.api.status(binding)).toEqual({ status: 'observed', observation: { ...recorded, status: 'connected' } });
    expect(f.resolve).toHaveBeenCalledTimes(2);
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.disconnect).not.toHaveBeenCalled();
});
it('status never authorizes capabilities or certifies coverage', async () => {
    const f = fixture();
    const result = await f.api.status(binding);
    expect(result).not.toHaveProperty('capabilities');
    expect(result).not.toHaveProperty('coverage');
});
it.each(['owner', 'generation', 'account'] as const)('rejects wrong requested %s before ports', async (fault) => {
    const f = fixture(), bad = { ...binding, ...(fault === 'owner' ? { ownerId: 'other' } : fault === 'generation' ? { generation: 3 } : { accountId: 'other' }) };
    expect(await f.api.status(bad)).toEqual({ status: 'forbidden' });
    expect(await f.api.disconnect({ binding: bad, operationKey: 'op' })).toEqual({ status: 'forbidden' });
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.disconnect).not.toHaveBeenCalled();
});
it('rejects revoked current scope before provider access', async () => { const f = fixture(); f.resolve.mockResolvedValue(null); expect(await f.api.status(binding)).toEqual({ status: 'forbidden' }); expect(f.get).not.toHaveBeenCalled(); });
it('rejects owner/account changes or revocation during provider read', async () => {
    const f = fixture();
    f.resolve.mockResolvedValueOnce(recorded).mockResolvedValueOnce({ ...recorded, ownerIdentity: { namespace: 'provider.owner', value: 'changed' } });
    expect(await f.api.status(binding)).toEqual({ status: 'forbidden' });
});
it('rejects forged observed binding/status instead of returning provider extras', async () => {
    const f = fixture();
    f.get.mockResolvedValue({ status: 'observed', observation: { ...recorded, binding: { ...binding, generation: 3 }, status: 'connected', credentials: 'private' } });
    expect(await f.api.status(binding)).toEqual({ status: 'unavailable' });
});
it('commits exclusive durable retirement before provider deletion and records terminal result', async () => {
    const f = fixture();
    expect(await f.api.disconnect({ binding, operationKey: 'operation' })).toEqual({ status: 'disconnected' });
    expect(f.prepare.mock.invocationCallOrder[0]).toBeLessThan(f.disconnect.mock.invocationCallOrder[0]);
    expect(f.disconnect.mock.invocationCallOrder[0]).toBeLessThan(f.finish.mock.invocationCallOrder[0]);
    expect(f.prepare.mock.calls[0].slice(0, 2)).toEqual([recorded, 'operation']);
    expect(f.finish.mock.calls[0][1]).toEqual({ status: 'disconnected' });
});
it.each(['duplicate', 'review'] as const)('durable %s never deletes again', async (status) => { const f = fixture(); f.prepare.mockResolvedValue({ status }); expect(await f.api.disconnect({ binding, operationKey: 'operation' })).toEqual({ status }); expect(f.disconnect).not.toHaveBeenCalled(); expect(f.finish).not.toHaveBeenCalled(); });
it('uncertain preparation never reaches provider', async () => { const f = fixture(); f.prepare.mockRejectedValue(Error('private database failure')); expect(await f.api.disconnect({ binding, operationKey: 'operation' })).toEqual({ status: 'unavailable' }); expect(f.disconnect).not.toHaveBeenCalled(); });
it('provider or terminal commit uncertainty stays unknown', async () => { const f = fixture(); f.disconnect.mockResolvedValue({ status: 'unknown' }); expect(await f.api.disconnect({ binding, operationKey: 'operation' })).toEqual({ status: 'unknown' }); expect(f.finish.mock.calls[0][1]).toEqual({ status: 'unknown' }); const g = fixture(); g.finish.mockRejectedValue(Error('lost COMMIT')); expect(await g.api.disconnect({ binding, operationKey: 'operation' })).toEqual({ status: 'unknown' }); expect(g.disconnect).toHaveBeenCalledTimes(1); });
it('rejects mismatched durable ticket without provider write', async () => { const f = fixture(); f.prepare.mockResolvedValue({ status: 'prepared', ticket: { record: { ...recorded, providerAccountId: 'other' }, operationKey: 'operation', token: 'a'.repeat(43) } }); expect(await f.api.disconnect({ binding, operationKey: 'operation' })).toEqual({ status: 'unavailable' }); expect(f.disconnect).not.toHaveBeenCalled(); });
it('snapshots caller binding before asynchronous authority resolution', async () => { const f = fixture(); let unblock: (v: RecordedLifecycleConnection) => void = () => { }; f.resolve.mockImplementationOnce(() => new Promise(resolve => { unblock = resolve; })); const caller = { ...binding }; const pending = f.api.status(caller); await Promise.resolve(); caller.ownerId = 'attacker'; unblock(structuredClone(recorded)); expect(await pending).toMatchObject({ status: 'observed' }); expect(f.get.mock.calls[0][0].binding).toEqual(binding); });
it('global deadline aborts stalled owner resolution without late provider calls', async () => { let unblock: (v: RecordedLifecycleConnection) => void = () => { }; const resolve = vi.fn().mockImplementation(() => new Promise(r => { unblock = r; })); const get = vi.fn(); const f = fixture({ timeoutMs: 10, resolveCurrent: resolve, provider: { get, disconnect: vi.fn() } }); expect(await f.api.status(binding)).toEqual({ status: 'unavailable' }); expect(resolve.mock.calls[0][1].aborted).toBe(true); unblock(recorded); await new Promise(r => setTimeout(r, 5)); expect(get).not.toHaveBeenCalled(); });
it('synchronous prepare overrun cannot cause a late provider deletion', async () => {
    const prepare = vi.fn(async (record, key) => { const end = performance.now() + 20; while (performance.now() < end) { } return { status: 'prepared' as const, ticket: { record, operationKey: key, token: 'a'.repeat(43) } }; });
    const f = fixture({ timeoutMs: 10, prepareDisconnect: prepare });
    expect(await f.api.disconnect({ binding, operationKey: 'op' })).toEqual({ status: 'unavailable' });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(f.disconnect).not.toHaveBeenCalled();
    expect(f.finish).not.toHaveBeenCalled();
});
it('global timeout during DELETE remains unknown and cannot start late finish work', async () => {
    let unblock: (v: {
        status: 'disconnected';
    }) => void = () => { };
    const remove = vi.fn<ConnectionLifecycleOptions['provider']['disconnect']>().mockImplementation(() => new Promise<{
        status: 'disconnected';
    }>(resolve => { unblock = resolve; }));
    const f = fixture({ timeoutMs: 10, provider: { get: async () => ({ status: 'observed', observation: { ...recorded, status: 'connected' } }), disconnect: remove } });
    expect(await f.api.disconnect({ binding, operationKey: 'op' })).toEqual({ status: 'unknown' });
    expect(remove.mock.calls[0][1].aborted).toBe(true);
    unblock({ status: 'disconnected' });
    await new Promise(r => setTimeout(r, 5));
    expect(f.finish).not.toHaveBeenCalled();
});
it('caller mutation and trusted provider callbacks cannot alter durable original metadata', async () => {
    const f = fixture();
    f.get.mockImplementation(async (record) => { const result = { status: 'observed', observation: { ...structuredClone(record), status: 'connected' } }; record.binding.ownerId = 'mutation'; record.ownerIdentity.value = 'mutation'; return result; });
    expect(await f.api.disconnect({ binding, operationKey: 'op' })).toEqual({ status: 'disconnected' });
    expect(f.prepare.mock.calls[0][0]).toEqual(recorded);
    expect(f.disconnect.mock.calls[0][0]).toEqual(recorded);
    expect(binding.ownerId).toBe('owner');
});
it('rejects and observes an invalid promised provider port under strict native Node', () => {
    const script = `const fs=require('node:fs'),ts=require('typescript');require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);const {createConnectionLifecycleCoordinator}=require(process.argv[1]);const binding=${JSON.stringify(binding)};try{createConnectionLifecycleCoordinator({binding,resolveCurrent:async()=>null,provider:Promise.reject(Error('synthetic rejected port')),prepareDisconnect:async()=>({status:'review'}),finishDisconnect:async()=>({status:'unknown'})});throw Error('Expected configuration rejection');}catch(error){if(error.message!=='Invalid connection lifecycle configuration')throw error;}setTimeout(()=>console.log('strict native lifecycle port guard passed'),10);`;
    const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '-e', script, fileURLToPath(new URL('./connection-lifecycle.ts', import.meta.url))], { cwd: process.cwd(), encoding: 'utf8', timeout: 3000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('strict native lifecycle port guard passed');
    expect(result.stderr).toBe('');
});
it('terminal disconnect replay is read-only even after provider account removal', async () => {
    const f = fixture();
    f.prepare.mockResolvedValue({ status: 'duplicate' });
    f.get.mockResolvedValue({ status: 'unavailable' });
    expect(await f.api.disconnect({ binding, operationKey: 'original-operation' })).toEqual({ status: 'duplicate' });
    expect(f.get).not.toHaveBeenCalled();
    expect(f.disconnect).not.toHaveBeenCalled();
});
it('captures the configured retirement port without an own bind substitution', async () => {
    const prepare = vi.fn<ConnectionLifecycleOptions['prepareDisconnect']>().mockResolvedValue({ status: 'review' });
    const substitution = vi.fn(() => async (record: RecordedLifecycleConnection, operationKey: string) => ({ status: 'prepared', ticket: { record, operationKey, token: 'a'.repeat(43) } }));
    Object.defineProperty(prepare, 'bind', { value: substitution });
    const f = fixture({ prepareDisconnect: prepare });
    expect(await f.api.disconnect({ binding, operationKey: 'op' })).toEqual({ status: 'review' });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(substitution).not.toHaveBeenCalled();
    expect(f.disconnect).not.toHaveBeenCalled();
});
it('captures the configured authority resolver without evaluating its own bind getter', async () => {
    const resolve = vi.fn<ConnectionLifecycleOptions['resolveCurrent']>().mockResolvedValue(null);
    const getter = vi.fn(() => () => async () => structuredClone(recorded));
    Object.defineProperty(resolve, 'bind', { get: getter });
    const f = fixture({ resolveCurrent: resolve });
    expect(await f.api.status(binding)).toEqual({ status: 'forbidden' });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(getter).not.toHaveBeenCalled();
    expect(f.get).not.toHaveBeenCalled();
});
