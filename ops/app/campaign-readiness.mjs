// Run inside the candidate container after DB health. No writes, migrations,
// provider scans or sending. A failed enforcement check invokes deploy rollback.
import pg from "pg";
import { verifyCampaignReplyRollout } from "./campaign-rollout-readiness.mjs";
if (process.env.CAMPAIGN_REPLY_MONITOR_MODE === "enforce") {
  const ca = process.env.DATABASE_SSL_CA || (process.env.DATABASE_SSL_CA_BASE64 ? Buffer.from(process.env.DATABASE_SSL_CA_BASE64, "base64").toString("utf8") : "");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}) });
  let actors;
  try {
    await db.connect(); await db.query("BEGIN READ ONLY");
    await db.query("SET LOCAL statement_timeout = '5s'");
    actors = (await db.query(`SELECT DISTINCT organization_id AS "organizationId", owner_user_id AS "userId"
      FROM campaign_enrolments WHERE state IN ('active','paused','needs_review') LIMIT 101`)).rows;
    await db.query("ROLLBACK");
  } finally { await db.end(); }
  await verifyCampaignReplyRollout("enforce", actors, async actor => {
    const url = new URL("/api/internal/campaigns/readiness", "http://127.0.0.1:3000");
    url.searchParams.set("organizationId", actor.organizationId); url.searchParams.set("userId", actor.userId);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.OUTREACH_WORKER_SECRET || ""}` }, signal: AbortSignal.timeout(25_000) });
    if (!response.ok) throw new Error("Campaign readiness request failed");
    return response.json();
  });
}
console.log("Campaign enforcement rollout readiness passed");
