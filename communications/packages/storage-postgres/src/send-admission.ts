import { types } from 'node:util';
import type { SqlClient } from './webhook-repository';
import type { ConnectionBinding, CanonicalIdentity } from '../../contracts/src';
export interface AdmissionCoveragePort {
    assertCoverage(client: SqlClient, input: {
        binding: ConnectionBinding;
        recipient: CanonicalIdentity;
        scopeDigest: string;
        requiredSince: string;
        maxAgeSeconds: number;
        serviceRevision: string;
    }): Promise<void>;
}
export interface DispatchQuotaPolicy {
    account: {
        hour: number;
        day: number;
        rollingDay?: number;
        minimumSpacingSeconds?: number;
    };
    application: {
        hour: number;
        day: number;
    };
}
/** Caller owns tenant/account/grant/lease transaction. Partial limits roll back together.
 * New approved quota rollup trigger additionally enforces application limits across accounts. */
export async function reserveDispatchQuotas(client: SqlClient, accountId: string, applicationId: string, inputPolicy: DispatchQuotaPolicy): Promise<boolean> {
    let policy: DispatchQuotaPolicy;
    try {
        policy = structuredClone(inputPolicy);
        if (!accountId || !applicationId || [policy.account.hour, policy.account.day, policy.application.hour, policy.application.day].some(v => !Number.isSafeInteger(v) || v < 0 || v > 2147483647))
            throw Error();
    }
    catch {
        throw Error('Dispatch journal unavailable');
    }
    const charges = (['account', 'application'] as const).flatMap(kind => (['hour', 'day'] as const).map(window => ({ kind, window, limit: policy[kind][window] })));
    if (charges.some(c => c.limit === 0))
        return false;
    await client.query('SAVEPOINT communication_admission_quota');
    try {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('communications.application-quota.v1:'||$1,0))", [applicationId]);
        for (const charge of charges) {
            const r = await client.query(`INSERT INTO communications.quota_buckets(account_id,bucket_kind,application_id,window_kind,window_start,used,limit_value) VALUES($1,$2,$3,$4,date_trunc($4::text,clock_timestamp()),1,$5) ON CONFLICT(account_id,bucket_kind,application_id,window_kind,window_start) DO UPDATE SET used=communications.quota_buckets.used+1 WHERE communications.quota_buckets.limit_value=$5 AND communications.quota_buckets.used<communications.quota_buckets.limit_value RETURNING used`, [accountId, charge.kind, charge.kind === 'account' ? '' : applicationId, charge.window, charge.limit]);
            if (r.rows.length !== 1) {
                await client.query('ROLLBACK TO SAVEPOINT communication_admission_quota');
                await client.query('RELEASE SAVEPOINT communication_admission_quota');
                return false;
            }
        }
        await client.query('RELEASE SAVEPOINT communication_admission_quota');
        return true;
    }
    catch (error) {
        if (error && typeof error === 'object' && !types.isProxy(error) && Object.getOwnPropertyDescriptor(error, 'code')?.value === 'PQUO1') {
            await client.query('ROLLBACK TO SAVEPOINT communication_admission_quota');
            await client.query('RELEASE SAVEPOINT communication_admission_quota');
            return false;
        }
        throw Error('Dispatch journal unavailable');
    }
}
