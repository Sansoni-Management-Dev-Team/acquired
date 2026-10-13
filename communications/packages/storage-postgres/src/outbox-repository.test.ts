import { describe, expect, it, vi } from 'vitest';
import type { ConnectionBinding } from '../../contracts/src';
import { createPostgresOutboxRepository, type OutboxRepositoryOptions } from './outbox-repository';
import type { SqlClient, SqlResult } from './webhook-repository';
const binding: ConnectionBinding = {
    applicationId: 'app', tenantId: 'tenant', ownerId: 'owner', connectionId: 'connection', accountId: 'account', generation: 1, channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile'
};
const role = {
    role_name: 'communications_control', rolsuper: false, rolbypassrls: false, rolcanlogin: false
};
const scopeRow = {
    connection_id: 'connection', application_id: 'app', tenant_id: 'tenant', owner_id: 'owner', account_id: 'account', generation: 1, channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile', grant_valid: true
};
type Step = {
    sql: RegExp;
    rows?: Record<string, unknown>[];
    error?: string;
};
function driver(steps: Step[]) {
    const calls: {
        sql: string;
        values?: unknown[];
    }[] = [], release = vi.fn();
    const query = async <Row>(sql: string, values?: unknown[]): Promise<SqlResult<Row>> => {
        calls.push({
            sql, values
        });
        const step = steps.shift();
        if (!step || !step.sql.test(sql))
            throw Error('Scripted protocol mismatch');
        if (step.error)
            throw Object.assign(Error('private database details'), {
                code: step.error
            });
        return {
            rows: (step.rows ?? []) as Row[]
        };
    };
    const client: SqlClient = {
        query, release
    };
    return {
        pool: {
            connect: vi.fn(async () => client)
        }, calls, release
    };
}
const prefix = (barrier: boolean = false): Step[] => [{
        sql: /^BEGIN$/
    }, {
        sql: /^SET LOCAL ROLE/
    }, {
        sql: /lock_timeout/
    }, {
        sql: /statement_timeout/
    }, {
        sql: /FROM pg_roles/, rows: [role]
    }, {
        sql: /to_regclass/, rows: [{
                barrier
            }]
    }];
const options = (d: ReturnType<typeof driver>, changes: Partial<OutboxRepositoryOptions> = {}): OutboxRepositoryOptions => ({
    pool: d.pool, binding: structuredClone(binding), subscriberId: 'subscriber', codec: {
        decode() {
            throw Error('Unexpected decode in guard fixture');
        }
    }, ...changes
});
describe('outbox repository guard protocol (scripted driver; no database durability claim)', () => {
    it.each([{
            subscriberId: ''
        }, {
            leaseSeconds: 0
        }, {
            leaseSeconds: 3601
        }, {
            leaseSeconds: 1.5
        }, {
            binding: {
                ...binding, generation: 0
            }
        }, {
            binding: {
                ...binding, ownerId: 'x'.repeat(201)
            }
        }, {
            binding: {
                ...binding, backend: 'browser'
            } as ConnectionBinding
        }])('rejects invalid fixed configuration %#', change => {
        const d = driver([]);
        expect(() => createPostgresOutboxRepository(options(d, change))).toThrow(/^Invalid outbox repository configuration$/);
        expect(d.pool.connect).not.toHaveBeenCalled();
    });
    it('fails closed when003 exists without explicit tenant-first port', async () => {
        const d = driver([...prefix(true), {
                sql: /^ROLLBACK$/
            }]);
        await expect(createPostgresOutboxRepository(options(d)).claim()).rejects.toThrow(/^Outbox repository unavailable$/);
        expect(d.calls.some(c => /FROM communications.connections/.test(c.sql))).toBe(false);
        expect(d.release).toHaveBeenCalledOnce();
    });
    it('locks exact configured tenant before original generation/grant or outbox locks', async () => {
        const d = driver([...prefix(true), {
                sql: /SELECT fixture_barrier/
            }, {
                sql: /FROM communications.connections/, rows: [scopeRow]
            }, {
                sql: /FROM communications.event_outbox/, rows: []
            }, {
                sql: /^COMMIT$/
            }]);
        const lock = vi.fn(async (client: SqlClient, app: string, tenant: string) => {
            expect([app, tenant]).toEqual(['app', 'tenant']);
            await client.query('SELECT fixture_barrier');
        });
        expect(await createPostgresOutboxRepository(options(d, {
            replyBarrier: {
                lock
            }
        })).claim()).toEqual({
            kind: 'busy'
        });
        expect(lock).toHaveBeenCalledOnce();
        expect(d.calls.findIndex(c => /fixture_barrier/.test(c.sql))).toBeLessThan(d.calls.findIndex(c => /FROM communications.connections/.test(c.sql)));
    });
    it('reports forbidden rather than delivering when original scope grant is absent', async () => {
        const d = driver([...prefix(), {
                sql: /FROM communications.connections/, rows: []
            }, {
                sql: /^ROLLBACK$/
            }]);
        expect(await createPostgresOutboxRepository(options(d)).claim()).toEqual({
            kind: 'forbidden'
        });
        expect(d.calls.some(c => /FROM communications.event_outbox/.test(c.sql))).toBe(false);
    });
    it.each([{
            rolsuper: true
        }, {
            rolbypassrls: true
        }, {
            rolcanlogin: true
        }, {
            role_name: 'other'
        }])('refuses unsafe effective database role %#', async (patch) => {
        const steps = prefix();
        steps.splice(4, 1, {
            sql: /FROM pg_roles/, rows: [{
                    ...role, ...patch
                }]
        });
        steps.splice(5, 1, {
            sql: /^ROLLBACK$/
        });
        const d = driver(steps);
        await expect(createPostgresOutboxRepository(options(d)).claim()).rejects.toThrow(/^Outbox repository unavailable$/);
        expect(d.calls.some(c => /FROM communications.connections/.test(c.sql))).toBe(false);
    });
    it('discards pooled session after uncertain COMMIT even when rollback returns', async () => {
        const d = driver([...prefix(), {
                sql: /FROM communications.connections/, rows: [scopeRow]
            }, {
                sql: /FROM communications.event_outbox/, rows: []
            }, {
                sql: /^COMMIT$/, error: 'ECONNRESET'
            }, {
                sql: /^ROLLBACK$/
            }]);
        await expect(createPostgresOutboxRepository(options(d)).claim()).rejects.toThrow(/^Outbox repository unavailable$/);
        expect(d.release).toHaveBeenCalledWith(expect.any(Error));
    });
    it('discards a client when rollback fails', async () => {
        const d = driver([{
                sql: /^BEGIN$/, error: 'synthetic'
            }, {
                sql: /^ROLLBACK$/, error: 'synthetic'
            }]);
        await expect(createPostgresOutboxRepository(options(d)).claim()).rejects.toThrow(/^Outbox repository unavailable$/);
        expect(d.release).toHaveBeenCalledWith(expect.any(Error));
    });
    it('captures fixed options before an asynchronous connection wait', async () => {
        const d = driver([...prefix(), {
                sql: /FROM communications.connections/, rows: [scopeRow]
            }, {
                sql: /FROM communications.event_outbox/, rows: []
            }, {
                sql: /^COMMIT$/
            }]);
        let resolve!: () => void;
        const wait = new Promise<void>(r => {
            resolve = r;
        }), connect = d.pool.connect;
        d.pool.connect = vi.fn(async () => {
            await wait;
            return connect();
        });
        const config = options(d), repo = createPostgresOutboxRepository(config), result = repo.claim();
        config.binding.ownerId = 'mutated';
        config.subscriberId = 'mutated';
        config.pool.connect = vi.fn(async () => {
            throw Error('Mutated method');
        });
        resolve();
        expect(await result).toEqual({
            kind: 'busy'
        });
        expect(d.calls.find(c => /FROM communications.connections/.test(c.sql))!.values).toEqual(['app', 'tenant', 'owner', 'connection', 'account', 1, 'whatsapp', 'whatsapp', 'unipile']);
    });
    it('rejects malformed receipt/delivery before any connection without leaking content', async () => {
        const d = driver([]), repo = createPostgresOutboxRepository(options(d));
        for (const input of [null, {}, {
                delivery: {
                    private: 'secret'
                }, receipt: {
                    private: 'secret'
                }
            }])
            expect(await repo.acknowledge(input as unknown as Parameters<typeof repo.acknowledge>[0])).toEqual({
                status: 'rejected'
            });
        expect(d.pool.connect).not.toHaveBeenCalled();
    });
});
