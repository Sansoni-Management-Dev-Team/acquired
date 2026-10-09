import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { assertCampaignWorkRemaining, campaignRemainingMs, CampaignWorkDeferred } from "@/lib/campaign-work-budget";

export type CampaignActor = { organizationId: string; userId: string };
const globalForCampaign = globalThis as typeof globalThis & { acquireCampaignPool?: Pool };

function pool() {
  if (globalForCampaign.acquireCampaignPool) return globalForCampaign.acquireCampaignPool;
  if (!process.env.DATABASE_URL) throw new Error("Database is not configured");
  const ca = process.env.DATABASE_SSL_CA;
  const created = new Pool({ connectionString: process.env.DATABASE_URL, ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}), max: 3, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 5_000 });
  attachDatabasePool(created);
  globalForCampaign.acquireCampaignPool = created;
  return created;
}

async function assertRlsRole(client: PoolClient, expected: string) {
  const result = await client.query<{ active_role: string; rolsuper: boolean; rolbypassrls: boolean }>("SELECT current_user AS active_role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
  if (result.rows[0]?.active_role !== expected || result.rows[0]?.rolsuper || result.rows[0]?.rolbypassrls) throw new Error("Campaign database role did not enter the expected RLS-enforced role");
}

async function scheduledClient(client: PoolClient): Promise<PoolClient> {
  const remaining = campaignRemainingMs();
  if (!Number.isFinite(remaining)) return client;
  assertCampaignWorkRemaining();
  // Server-side cancellation bounds lock waits too. The client timeout has a
  // small margin so PostgreSQL can report cancellation and roll back cleanly.
  await client.query("SELECT set_config('statement_timeout', $1, true)", [String(Math.min(5000, remaining))]);
  return new Proxy(client, {
    get(target, property) {
      if (property !== "query") return Reflect.get(target, property);
      return async (text: string, values?: unknown[]) => {
        assertCampaignWorkRemaining();
        try {
          const config = { text, values, query_timeout: Math.min(5000, campaignRemainingMs()) + 1000 };
          return await target.query(config);
        } catch (error) {
          if ((error as { code?: string }).code === "57014" || /query read timeout/i.test(String(error))) throw new CampaignWorkDeferred();
          throw error;
        }
      };
    },
  });
}

export async function withCampaignDb<T>(actor: CampaignActor, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  assertCampaignWorkRemaining();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const scoped = await scheduledClient(client);
    await scoped.query("SET LOCAL ROLE acquire_campaign_user");
    await assertRlsRole(scoped, "acquire_campaign_user");
    await scoped.query("SELECT set_config('app.acquire_org', $1, true), set_config('app.acquire_user', $2, true)", [actor.organizationId, actor.userId]);
    const membership = await scoped.query("SELECT 1 FROM member WHERE organization_id = $1 AND user_id = $2 LIMIT 1", [actor.organizationId, actor.userId]);
    if (!membership.rowCount) throw new Error("Campaign owner is no longer an organization member");
    const result = await callback(scoped);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// The worker role is only entered from the bearer-secret route. Individual
// sends still re-enter the restricted user role with the job's recorded owner.
export async function withCampaignWorker<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  assertCampaignWorkRemaining();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const scoped = await scheduledClient(client);
    await scoped.query("SET LOCAL ROLE acquire_campaign_worker");
    await assertRlsRole(scoped, "acquire_campaign_worker");
    const result = await callback(scoped);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// A transaction-level advisory lock also works through transaction poolers.
// It holds no row locks and rolls back on disconnect; other work uses separate
// scoped transactions so its successful commits survive this lock's rollback.
export async function withCampaignTickLock<T>(callback: () => Promise<T>): Promise<{ acquired: false } | { acquired: true; result: T }> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_xact_lock(1094930773, 1) AS acquired");
    if (!lock.rows[0].acquired) return { acquired: false };
    return { acquired: true, result: await callback() };
  } finally {
    try { await client.query("ROLLBACK"); } finally { client.release(); }
  }
}

export async function rows<T extends QueryResultRow>(client: PoolClient, query: string, values: unknown[] = []): Promise<T[]> {
  return (await client.query<T>(query, values)).rows;
}
