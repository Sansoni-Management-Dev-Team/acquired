import { expect, it, vi } from 'vitest';
import { lockAcquireSendGate } from './campaign-send-gate';
it('is inert when the new gate is absent on a compatibility writer', async () => {
    const query = vi.fn(async () => ({ rows: [{ installed: false }] }));
    expect(await lockAcquireSendGate({ query }, 'synthetic-org')).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
});
it('requires installed gate for actual authority and validates a database revision', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ installed: true }] }).mockResolvedValueOnce({ rows: [{ revision: '4' }] });
    expect(await lockAcquireSendGate({ query }, 'synthetic-org', { required: true })).toBe('4');
    expect(query.mock.calls[1]).toEqual(['SELECT public.communications_lock_send_gate($1)::text AS revision', ['synthetic-org']]);
});
it('fails closed without an installed gate on configured admission', async () => {
    const query = vi.fn(async () => ({ rows: [{ installed: false }] }));
    await expect(lockAcquireSendGate({ query }, 'synthetic-org', { required: true })).rejects.toThrow('Send authority unavailable');
    expect(query).toHaveBeenCalledTimes(1);
});
it('rejects invalid revisions without trusting a GUC as authority', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ installed: true }] }).mockResolvedValueOnce({ rows: [{ revision: '-1' }] });
    await expect(lockAcquireSendGate({ query }, 'synthetic-org')).rejects.toThrow('Send authority unavailable');
});
