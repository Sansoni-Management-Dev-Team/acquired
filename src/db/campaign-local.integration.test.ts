import { localCampaignDatabase } from "../../scripts/campaign-integration-support.mjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";

// Opt in only to the dedicated loopback database. Fixtures always roll back;
// these tests never create schema objects or invoke providers.
const enabled = process.env.CAMPAIGN_AUDIT_LOCAL_DB === "1";
describe.skipIf(!enabled)("local campaign database constraints", () => {
  const client = new pg.Client({ connectionString: localCampaignDatabase, connectionTimeoutMillis: 5000 });
  const actor = `campaign-audit-${randomUUID()}`; const other = `campaign-audit-${randomUUID()}`; const org = `campaign-audit-${randomUUID()}`;
  const mandateId = randomUUID(), sequenceId = randomUUID(), versionId = randomUUID();
  beforeAll(async () => {
    await client.connect(); await client.query("BEGIN");
    await client.query('INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ($1,$1,$2,false,now(),now()),($3,$3,$4,false,now(),now())', [actor, `${actor}@example.invalid`, other, `${other}@example.invalid`]);
    await client.query("INSERT INTO organization (id,name,slug) VALUES ($1,$1,$1)", [org]);
    await client.query("INSERT INTO member (id,organization_id,user_id,role) VALUES ($1,$2,$3,'owner'),($4,$2,$5,'member')", [randomUUID(), org, actor, randomUUID(), other]);
    await client.query("INSERT INTO mandates (id,organization_id,natural_language,filters,provenance,created_by) VALUES ($1,$2,'Synthetic audit','{}','{}',$3)", [mandateId, org, actor]);
    await client.query("INSERT INTO campaign_sequences (id,organization_id,owner_user_id,mandate_id,name,draft) VALUES ($1,$2,$3,$4,'Synthetic audit','{}')", [sequenceId, org, actor, mandateId]);
    await client.query("INSERT INTO campaign_sequence_versions (id,organization_id,owner_user_id,sequence_id,version,definition) VALUES ($1,$2,$3,$4,1,'{}')", [versionId, org, actor, sequenceId]);
    await client.query("SET LOCAL ROLE acquire_campaign_user"); await client.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)", [org, actor]);
  });
  afterAll(async () => { try { await client.query("ROLLBACK"); } finally { await client.end(); } });
  async function owner(user: string, organization = org) { await client.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)", [organization, user]); }
  it("uses a role that cannot bypass RLS and sees only its fixture", async () => {
    await owner(actor); const role = (await client.query("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0]; expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    expect((await client.query("SELECT id FROM campaign_sequences")).rows).toEqual([{ id: sequenceId }]);
  });
  it("another owner in the same organisation cannot read or mutate the sequence", async () => {
    await owner(other); expect((await client.query("SELECT id FROM campaign_sequences WHERE id=$1", [sequenceId])).rows).toEqual([]);
    expect((await client.query("UPDATE campaign_sequences SET name='Unauthorized' WHERE id=$1", [sequenceId])).rowCount).toBe(0);
    await owner(actor); expect((await client.query("SELECT name FROM campaign_sequences WHERE id=$1", [sequenceId])).rows[0].name).toBe("Synthetic audit");
  });
  it("another organisation cannot see even a known version id", async () => { await owner(actor, "unrelated-org"); expect((await client.query("SELECT id FROM campaign_sequence_versions WHERE id=$1", [versionId])).rows).toEqual([]); await owner(actor); });
  it("published versions cannot be edited by the runtime user role", async () => {
    await owner(actor); await client.query("SAVEPOINT forbidden_update");
    try { await expect(client.query("UPDATE campaign_sequence_versions SET definition='{}' WHERE id=$1", [versionId])).rejects.toMatchObject({ code: "42501" }); }
    finally { await client.query("ROLLBACK TO SAVEPOINT forbidden_update"); }
  });
  it("a duplicate version number is rejected by the database", async () => {
    await owner(actor); await client.query("SAVEPOINT duplicate_version");
    try { await expect(client.query("INSERT INTO campaign_sequence_versions (organization_id,owner_user_id,sequence_id,version,definition) VALUES ($1,$2,$3,1,'{}')", [org, actor, sequenceId])).rejects.toMatchObject({ code: "23505" }); }
    finally { await client.query("ROLLBACK TO SAVEPOINT duplicate_version"); }
  });
});

describe.skipIf(!enabled)("local mailbox lock contention", () => {
  it("serializes the same mailbox and releases locks after rollback without blocking another mailbox", async () => {
    const first = new pg.Client({ connectionString: localCampaignDatabase });
    const second = new pg.Client({ connectionString: localCampaignDatabase });
    const key = `synthetic-mailbox-${randomUUID()}`;
    try {
      await Promise.all([first.connect(), second.connect()]); await first.query("BEGIN"); await second.query("BEGIN");
      await first.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
      expect((await second.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired", [key])).rows[0].acquired).toBe(false);
      expect((await second.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired", [`${key}-other`])).rows[0].acquired).toBe(true);
      await first.query("ROLLBACK"); expect((await second.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired", [key])).rows[0].acquired).toBe(true);
    } finally { await Promise.allSettled([first.query("ROLLBACK"), second.query("ROLLBACK")]); await Promise.all([first.end(), second.end()]); }
  });
});
