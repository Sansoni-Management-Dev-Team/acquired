import { and, eq, sql } from 'drizzle-orm';
import { requireDb } from './client';
import { researchJobs } from './schema';
export const SCHEDULING_LEASE_MS = 60_000;
export const SCHEDULING_RECOVERY_MS = 15_000;
const state = sql`COALESCE(${researchJobs.config}->'scheduling', '{}'::jsonb)`;
const generation = sql`COALESCE((${state}->>'generation')::bigint, 0)`;
const expires = sql`COALESCE((${state}->>'expiresAt')::bigint, 0)`;
const clock = sql`floor(extract(epoch from clock_timestamp()) * 1000)::bigint`;
/** An event increments generation even while another owner holds the lease.
 * Recovery polling does not manufacture events or repeatedly extend the lease. */
export async function requestSchedulingLease(org: string, rootId: string, owner: string, recovery = false) {
 const available = sql`(${expires} <= ${clock})`;
 const next = recovery ? generation : sql`${generation} + 1`;
 const [row] = await requireDb().update(researchJobs).set({config:sql`jsonb_set(${researchJobs.config}, '{scheduling}', ${state} || jsonb_build_object('generation', ${next}, 'owner', CASE WHEN ${available} THEN ${owner}::text ELSE ${state}->>'owner' END, 'expiresAt', CASE WHEN ${available} THEN ${clock} + ${SCHEDULING_LEASE_MS}::bigint ELSE ${expires} END, 'lastPassAt', CASE WHEN ${available} THEN ${clock} ELSE COALESCE((${state}->>'lastPassAt')::bigint, 0) END))`}).where(and(eq(researchJobs.organizationId,org),eq(researchJobs.id,rootId),sql`${researchJobs.status} <> 'cancelled'`, recovery ? sql`${available} AND COALESCE((${state}->>'lastPassAt')::bigint, 0) <= ${clock} - ${SCHEDULING_RECOVERY_MS}::bigint` : undefined)).returning({config:sql<Record<string,unknown>>`jsonb_build_object('scheduling', ${researchJobs.config}->'scheduling')`});
 const s = (row?.config as {scheduling?:unknown}|undefined)?.scheduling as {owner?:string;generation?:number} | undefined;
 return {acquired:s?.owner === owner,generation:s?.generation || 0};
}
/** Check pending generation and release atomically, preventing a lost wake-up. */
export async function finishSchedulingPass(org:string,rootId:string,owner:string,seen:number) {
 const pending = sql`${generation} > ${seen}::bigint`;
 const [row] = await requireDb().update(researchJobs).set({config:sql`jsonb_set(${researchJobs.config}, '{scheduling}', ${state} || jsonb_build_object('completedGeneration', ${seen}::bigint, 'owner', CASE WHEN ${pending} THEN ${owner}::text ELSE NULL::text END, 'expiresAt', CASE WHEN ${pending} THEN ${clock} + ${SCHEDULING_LEASE_MS}::bigint ELSE 0::bigint END))`}).where(and(eq(researchJobs.organizationId,org),eq(researchJobs.id,rootId),sql`${state}->>'owner' = ${owner}::text AND ${expires} > ${clock}`)).returning({config:sql<Record<string,unknown>>`jsonb_build_object('scheduling', ${researchJobs.config}->'scheduling')`});
 const s = (row?.config as {scheduling?:unknown}|undefined)?.scheduling as {owner?:string;generation?:number} | undefined;
 return {again:s?.owner === owner,generation:s?.generation || seen};
}
