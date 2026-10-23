import{ReplyProcessingPendingError}from'../../core/src/history-pending';
import { types } from 'node:util';
import type { SqlPool, SqlClient } from './webhook-repository';
/** release(error) MUST terminate the physical connection. No rollback races an unfinished query.
 * Every transaction retires its dedicated checked-out session; provider reads never run here; withCoverage may hold a trusted application callback. */
export function historyTransaction(pool: SqlPool, budgetMs = 20000) {
    if (types.isProxy(pool) || !pool || typeof pool.connect !== 'function' || !Number.isInteger(budgetMs) || budgetMs < 1 || budgetMs > 60000)
        throw Error('History storage unavailable');
    const connect = Function.prototype.bind.call(pool.connect, pool);
    return async function tx<T>(signal: AbortSignal | undefined, work: (client: SqlClient, check: () => void, signal: AbortSignal) => Promise<T>): Promise<T> {
        const controller = new AbortController();
        let client: SqlClient | undefined, closed = false, commit = false, timer: ReturnType<typeof setTimeout> | undefined;
        const end = performance.now() + budgetMs;
        const fail = () => { throw Error('History storage unavailable'); }, check = () => {
            if (closed || controller.signal.aborted || signal?.aborted || performance.now() >= end)
                fail();
        };
        const dispose = () => {
            if (client && !closed) {
                closed = true;
                try {
                    client.release(Error(commit ? 'History commit uncertain/session retired' : 'History session retired'));
                }
                catch { /* Driver termination contract. */ }
            }
        };
        let rejectAbort: (e: Error) => void = () => { };
        const abort = () => { dispose(); controller.abort(); rejectAbort(Error('History storage unavailable')); };
        const deadline = new Promise<never>((_, reject) => { rejectAbort = reject; timer = setTimeout(abort, budgetMs); });
        signal?.addEventListener('abort', abort, { once: true });
        const run = async () => {
            check();
            const late = await connect();
            if (closed || controller.signal.aborted || signal?.aborted || performance.now() >= end) {
                late.release(Error('Late history connection'));
                fail();
            }
            client = late;
            const query = Function.prototype.bind.call(late.query, late);
            const guarded: SqlClient = { release() { fail(); }, query: async (text, values) => { check(); const result = await query(text, values); check(); return result; } };
            await guarded.query('BEGIN');
            await guarded.query('SET LOCAL ROLE communications_control');
            await guarded.query("SET LOCAL search_path=pg_catalog,communications");
            await guarded.query("SET LOCAL statement_timeout='15000ms'");
            await guarded.query("SET LOCAL lock_timeout='2000ms'");
            const roles = await guarded.query("SELECT current_user AS role,rolsuper,rolbypassrls,rolcanlogin FROM pg_catalog.pg_roles WHERE rolname=current_user");
            const role = roles.rows[0];
            if (roles.rows.length !== 1 || role.role !== 'communications_control' || role.rolsuper !== false || role.rolbypassrls !== false || role.rolcanlogin !== false)
                fail();
            const value = await work(guarded, check, controller.signal);
            check();
            commit = true;
            await guarded.query('COMMIT');
            return value;
        };
        try {
            return await Promise.race([run(), deadline]);
        }
        catch(error) {
            const pending=error instanceof ReplyProcessingPendingError&&!commit&&!closed&&!controller.signal.aborted&&!signal?.aborted&&performance.now()<end;
            dispose();
            if(pending)throw error;
            throw Error('History storage unavailable');
        }
        finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            dispose();
            controller.abort();
        }
    };
}
