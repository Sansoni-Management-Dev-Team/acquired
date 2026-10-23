import {businessSql,type BusinessClock} from '../../core/src/business-clock';
import { types } from 'node:util';
import type { DispatchBlock } from '../../core/src/dispatch';
import type { SqlClient } from './webhook-repository';
export interface RollingAccountPolicy {
    rollingDay?: number;
    minimumSpacingSeconds?: number;
}
export type RollingPolicyDecision = {
    allowed: true;
} | {
    allowed: false;
    outcome: DispatchBlock;
};
function fail(): never { throw Error('Dispatch journal unavailable'); }
function timestamp(value: unknown): string {
    if (value instanceof Date) {
        const time = Date.prototype.getTime.call(value);
        if (!Number.isFinite(time))
            fail();
        return new Date(time).toISOString();
    }
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
        fail();
    return value;
}
/** Read-only under the caller's original physical-account lock. Charged admissions include
 * uncertain application commits and rejected provider attempts: this policy never refunds them.
 * Calendar quotas and current authority still must pass; allowed is not a provider permit. */
export async function checkRollingDispatchPolicy(client: SqlClient, accountId: string, input: RollingAccountPolicy,businessClock?:BusinessClock): Promise<RollingPolicyDecision> {
    try {
        if (typeof accountId !== 'string' || !accountId || accountId.length > 200 || accountId.trim() !== accountId || /[\u0000-\u001f\u007f]/.test(accountId) || !input || typeof input !== 'object' || types.isProxy(input) || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input)))
            fail();
        const descriptors = Object.getOwnPropertyDescriptors(input);
        if (Reflect.ownKeys(descriptors).some(k => typeof k !== 'string' || !['rollingDay', 'minimumSpacingSeconds'].includes(k) || !('value' in descriptors[k])))
            fail();
        const rolling = descriptors.rollingDay?.value, spacing = descriptors.minimumSpacingSeconds?.value;
        if (rolling !== undefined && (!Number.isSafeInteger(rolling) || rolling < 0 || rolling > 2147483647) || spacing !== undefined && (!Number.isSafeInteger(spacing) || spacing < 0 || spacing > 86400))
            fail();
        if (rolling === 0)
            return { allowed: false, outcome: { status: 'review', code: 'delivery_disabled' } };
        if (rolling === undefined && (spacing === undefined || spacing === 0))
            return { allowed: true };
        const result = await client.query(`WITH policy_clock AS MATERIALIZED(SELECT ${businessSql(businessClock)} AS now),
charged AS MATERIALIZED(SELECT ${businessClock?'a.id AS admission_id,a.business_admitted_at':'a.created_at'} AS created_at,j.account_id AS journal_account,j.quota_reserved,j.state,${businessClock?'a.business_admitted_at AS updated_at':'j.updated_at'},j.claim_until FROM communications.dispatch_admissions a LEFT JOIN communications.operation_journal j ON j.id=a.journal_id WHERE a.account_id=$1),
facts AS(SELECT coalesce(bool_and(CASE WHEN ${businessClock?'admission_id IS NULL':'created_at IS NULL'} THEN true ELSE coalesce(journal_account=$1 AND quota_reserved AND state IN('dispatching','unknown','submitted','blocked','rejected','skipped') AND created_at<=p.now AND updated_at>=created_at AND updated_at<=p.now AND claim_until IS NOT NULL,false) END),true) AS policy_valid,
 coalesce(bool_or(state IN('dispatching','unknown')),false) AS unresolved,
 ($2::integer IS NULL OR count(*) FILTER(WHERE created_at>p.now-interval '24 hours')<$2) AS rolling_ready,
 ($3::integer=0 OR coalesce(max(GREATEST(updated_at,CASE WHEN state IN('dispatching','unknown') THEN claim_until ELSE updated_at END))+($3::double precision*interval '1 second')<=p.now,true)) AS spacing_ready,
 max(GREATEST(updated_at,CASE WHEN state IN('dispatching','unknown') THEN claim_until ELSE updated_at END))+($3::double precision*interval '1 second') AS spacing_retry FROM policy_clock p LEFT JOIN charged ON true GROUP BY p.now),
rolling_boundary AS(SELECT created_at+interval '24 hours' AS retry_at FROM charged CROSS JOIN policy_clock p WHERE created_at>p.now-interval '24 hours' ORDER BY created_at DESC OFFSET GREATEST(coalesce($2::integer,1)-1,0) LIMIT 1)
SELECT f.policy_valid,f.unresolved,f.rolling_ready,f.spacing_ready,p.now AS observed_at,GREATEST(CASE WHEN NOT f.rolling_ready THEN (SELECT retry_at FROM rolling_boundary) END,CASE WHEN NOT f.spacing_ready THEN f.spacing_retry END) AS retry_at FROM policy_clock p LEFT JOIN facts f ON true`, [accountId, rolling ?? null, spacing ?? 0]);
        // Empty inventories still need one explicit valid row; no missing-proof fallback.
        if (result.rows.length !== 1)
            fail();
        const row = result.rows[0];
        if (row.policy_valid !== true || typeof row.unresolved !== 'boolean' || typeof row.rolling_ready !== 'boolean' || typeof row.spacing_ready !== 'boolean')
            fail();
        const observed = timestamp(row.observed_at);
        if (row.unresolved)
            return { allowed: false, outcome: { status: 'review', code: 'unresolved_send' } };
        if (row.rolling_ready && row.spacing_ready) {
            if (row.retry_at !== null)
                fail();
            return { allowed: true };
        }
        const retryAt = timestamp(row.retry_at);
        if (Date.parse(retryAt) <= Date.parse(observed))
            fail();
        return { allowed: false, outcome: { status: 'waiting', code: 'rate_limited', retryAt } };
    }
    catch {
        fail();
    }
}
