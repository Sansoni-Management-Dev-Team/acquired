export interface SendGateClient {
    query(sql: string, values?: unknown[]): Promise<{
        rows: Record<string, unknown>[];
    }>;
}
/** Application writer gate, acquired before membership/policy/target locks.
 * Compatibility writers can remain inert until the final specifically approved schema exists. */
export async function lockAcquireSendGate(client: SendGateClient, organizationId: string, options: {
    required?: boolean;
} = {}): Promise<string | null> {
    try {
        if (typeof organizationId !== 'string' || !organizationId || organizationId.length > 200 || organizationId !== organizationId.trim() || /[\u0000-\u001f\u007f]/.test(organizationId))
            throw Error();
        const installed = await client.query("SELECT to_regprocedure('public.communications_lock_send_gate(text)') IS NOT NULL AS installed");
        if (installed.rows.length !== 1 || typeof installed.rows[0].installed !== 'boolean')
            throw Error();
        if (!installed.rows[0].installed) {
            if (options.required === true)
                throw Error();
            return null;
        }
        const locked = await client.query('SELECT public.communications_lock_send_gate($1)::text AS revision', [organizationId]);
        const revision = locked.rows[0]?.revision;
        if (locked.rows.length !== 1 || typeof revision !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(revision) || BigInt(revision) > BigInt('9223372036854775807'))
            throw Error();
        return revision;
    }
    catch {
        throw Error('Send authority unavailable');
    }
}
