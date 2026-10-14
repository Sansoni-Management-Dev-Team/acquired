import { performance } from 'node:perf_hooks';
import type { SqlClient, SqlPool, SqlResult } from './webhook-repository';
/** Repository-owned SQL only. release(error) must terminate the session, not return it to pool. */
export async function runtimeTransaction<T>(pool: SqlPool, timeout: number, work: (client: SqlClient) => Promise<T>): Promise<T> {
    const deadline = performance.now() + timeout;
    let client: SqlClient | undefined, released = false, active = 0, commit = false, expired = false, broken: Error | undefined;
    const fail = (): never => { throw Error('Account runtime unavailable'); };
    const release = () => { if (client && !released) {
        released = true;
        try {
            client.release(broken);
        }
        catch { /* private */ }
    } };
    const stop = () => { expired = true; broken = Error('Account runtime session retired'); release(); };
    const live = () => { if (expired || performance.now() >= deadline) {
        stop();
        fail();
    } if (released)
        fail(); };
    let timer: ReturnType<typeof setTimeout>;
    const stopped = new Promise<never>((_, reject) => { timer = setTimeout(() => { stop(); reject(Error('Account runtime unavailable')); }, timeout); });
    const run = async () => {
        try {
            live();
            const pending = Promise.resolve().then(() => pool.connect()).then(value => { client = value; live(); return value; });
            void pending.catch(() => { });
            client = await pending;
            live();
            const query = Function.prototype.bind.call(client.query, client) as SqlClient['query'];
            const tx: SqlClient = { query<Row>(sql: string, values?: unknown[]) { let request: Promise<SqlResult<Row>>; try {
                    live();
                    if (active)
                        fail();
                    if (sql === 'COMMIT')
                        commit = true;
                    active++;
                    request = Promise.resolve().then(() => { live(); return query<Row>(sql, values); }).then(result => { live(); return result; }).finally(() => active--);
                }
                catch {
                    request = Promise.reject(Error('Account runtime unavailable'));
                } void request.catch(() => { }); return request; }, release() { fail(); } };
            await tx.query('BEGIN');
            await tx.query('SET LOCAL ROLE communications_control');
            const roles = await tx.query('SELECT current_user AS role_name,rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname=current_user'), r = roles.rows[0];
            if (roles.rows.length !== 1 || r.role_name !== 'communications_control' || r.rolsuper !== false || r.rolbypassrls !== false || r.rolcanlogin !== false)
                fail();
            await tx.query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true)", [`${Math.min(timeout, 1000)}ms`, `${Math.min(timeout, 5000)}ms`]);
            const result = await work(tx);
            live();
            await tx.query('COMMIT');
            return result;
        }
        catch (error) {
            const code = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined;
            if (commit || active || expired || performance.now() >= deadline || typeof code === 'string' && (/^(08|57P)/.test(code) || ['ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(code))) {
                broken = Error('Account runtime session retired');
                release();
            }
            if (client && !released) {
                try {
                    await client.query('ROLLBACK');
                }
                catch {
                    broken = Error('Account runtime session retired');
                }
            }
            return fail();
        }
        finally {
            release();
        }
    };
    try {
        return await Promise.race([Promise.resolve().then(run), stopped]);
    }
    finally {
        clearTimeout(timer!);
    }
}
