import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { CampaignDefinition } from "@/domain/campaign";

vi.mock("server-only", () => ({}));
vi.mock("@vercel/functions", () => ({ attachDatabasePool: vi.fn() }));
const providers = vi.hoisted(() => ({ gmail: vi.fn(), linkedin: vi.fn() }));
vi.mock("@/lib/campaign-mailbox", () => ({ campaignTestSendAnytime: () => true, campaignMailboxForConnection: providers.gmail }));
vi.mock("@/lib/campaign-n8n", () => ({ n8nCampaignEnabled: () => false }));
vi.mock("@/lib/campaign-linkedin", async original => ({ ...await original<typeof import("@/lib/campaign-linkedin")>(), linkedinCampaignEnabled: () => true, campaignLinkedinAccountStatus: async () => "connected", campaignLinkedin: providers.linkedin }));
vi.mock("@/lib/campaign-reply-providers", () => ({ readChannelReplies: async () => ({ accountIdentity: "synthetic-linkedin-account", events: [], nextCursor: "complete", complete: true, checkedAt: new Date().toISOString() }) }));
import { createMandateContact, createCampaign, publishCampaign, enrolContacts, listCampaignStudio, processCampaignEnrolment } from "@/lib/campaign-service";
import { ingestCampaignReply } from "@/lib/campaign-reply-store";

// Real local schema, pooled transactions and RLS. All provider calls are replaced.
// This suite never runs migrations or sends to a real account.
describe.skipIf(process.env.CAMPAIGN_AUDIT_LOCAL_DB !== "1")("optional people and LinkedIn-only local integration", () => {
  const url = "postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire";
  const db = new pg.Client({ connectionString: url });
  const org = `optional-people-${randomUUID()}`, user = `optional-people-${randomUUID()}`, mandate = randomUUID();
  const actor = { organizationId: org, userId: user };
  const definition = (): CampaignDefinition => ({ schemaVersion: 1, steps: [{ id: randomUUID(), kind: "linkedin", action: "connect", title: "Connect", body: "" }] });
  const profile = () => `https://www.linkedin.com/in/synthetic-${randomUUID()}`;
  const recipient = (profile: string) => `urn:li:fsd_profile:${profile.split("/").pop()}`;
  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", url); vi.stubEnv("DATABASE_SSL_CA", ""); vi.stubEnv("CAMPAIGN_REPLY_MONITOR_MODE", "enforce");
    providers.gmail.mockImplementation(() => { throw new Error("LinkedIn-only sequences must not access Gmail"); });
    providers.linkedin.mockImplementation(async (_actor, input) => input.operation === "status" ? { connected: true, recipient: recipient(input.profile) } : { action: { id: randomUUID(), status: "submitted" } });
    await db.connect();
    const schema = await db.query("SELECT 1 FROM information_schema.columns WHERE table_name='contacts' AND column_name='mandate_id'");
    if (!schema.rowCount) throw new Error("Approve and apply migration 0017 before running this test. This suite never migrates.");
    await db.query("BEGIN");
    try {
      await db.query('INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ($1,$1,$2,false,now(),now())', [user, `${user}@example.invalid`]);
      await db.query("INSERT INTO organization (id,name,slug) VALUES ($1,$1,$1)", [org]);
      await db.query("INSERT INTO member (id,organization_id,user_id,role) VALUES ($1,$2,$3,'owner')", [randomUUID(), org, user]);
      await db.query("INSERT INTO mandates (id,organization_id,natural_language,filters,provenance,created_by) VALUES ($1,$2,'Synthetic optional people','{}','{}',$3)", [mandate, org, user]);
      await db.query("COMMIT");
    } catch (error) { await db.query("ROLLBACK"); throw error; }
  });
  afterAll(async () => {
    try {
      await db.query("BEGIN");
      for (const table of ["campaign_reply_receipts", "campaign_reply_monitors", "campaign_reply_holds", "campaign_reply_identities", "campaign_send_attempts", "campaign_inbound_events", "campaign_enrolments", "campaign_contact_assignments", "campaign_contact_holds", "campaign_sequence_versions", "campaign_sequences", "audit_events", "contacts", "mandates", "member"]) await db.query(`DELETE FROM ${table} WHERE organization_id=$1`, [org]);
      await db.query("DELETE FROM organization WHERE id=$1", [org]);
      await db.query('DELETE FROM "user" WHERE id=$1', [user]);
      await db.query("COMMIT");
    } finally {
      await db.end();
      const globals = globalThis as typeof globalThis & { acquireCampaignPool?: pg.Pool };
      await globals.acquireCampaignPool?.end(); delete globals.acquireCampaignPool; vi.unstubAllEnvs();
    }
  });
  async function published(draft = definition()) {
    const sequence = await createCampaign(actor, mandate, "Synthetic connection request", draft);
    await publishCampaign(actor, sequence.id);
    return sequence.id;
  }
  it("stores and lists an empty person without inventing a company or email", async () => {
    const contact = await createMandateContact(actor, mandate, {});
    const studio = await listCampaignStudio(actor, mandate);
    expect(studio.contacts.find(item => item.id === contact.id)).toMatchObject({ name: "", company: "", email: null, phone: null, linkedinUrl: null });
    expect((await db.query("SELECT target_id,mandate_id FROM contacts WHERE id=$1", [contact.id])).rows[0]).toEqual({ target_id: null, mandate_id: mandate });
  });
  it("subscribes and delivers a connection request with no name, company, email or mailbox", async () => {
    const linkedinUrl = profile();
    const contact = await createMandateContact(actor, mandate, { linkedinUrl });
    const [enrolment] = await enrolContacts(actor, await published(), [contact.id]);
    expect(enrolment.state).toBe("active");
    expect((await db.query("SELECT recipient_email,mailbox_connection_id,recipient_linkedin FROM campaign_enrolments WHERE id=$1", [enrolment.id])).rows[0]).toEqual({ recipient_email: null, mailbox_connection_id: null, recipient_linkedin: linkedinUrl });
    expect(await processCampaignEnrolment(actor, enrolment.id)).toMatchObject({ outcome: "sent" });
    expect(providers.linkedin).toHaveBeenCalledWith(actor, expect.objectContaining({ operation: "connect", profile: linkedinUrl, text: "" }));
    expect(providers.gmail).not.toHaveBeenCalled();
  });
  it("rejects an email sequence for a person without an email", async () => {
    const contact = await createMandateContact(actor, mandate, { linkedinUrl: profile() });
    const draft: CampaignDefinition = { schemaVersion: 1, steps: [{ id: randomUUID(), kind: "email", title: "Email", subject: "Hello", body: "Hi" }] };
    await expect(enrolContacts(actor, await published(draft), [contact.id])).rejects.toThrow();
  });
  it("holds duplicate LinkedIn recipients and stops an email-free enrolment on a LinkedIn reply", async () => {
    const linkedinUrl = profile();
    const first = await createMandateContact(actor, mandate, { linkedinUrl });
    const duplicate = await createMandateContact(actor, mandate, { linkedinUrl: linkedinUrl.replace("www.", "au.") + "/?tracking=1" });
    const sequence = await published();
    const [enrolment] = await enrolContacts(actor, sequence, [first.id]);
    await expect(enrolContacts(actor, sequence, [duplicate.id])).rejects.toThrow("already has active outreach");
    // The fixture must be later than DB registration, including submillisecond
    // precision and host/container clock differences.
    const [identity] = (await db.query("SELECT max(since) + interval '1 second' AS received_at FROM campaign_reply_identities WHERE contact_id=$1", [first.id])).rows;
    await ingestCampaignReply(actor, "linkedin", "synthetic-linkedin-account", { id: randomUUID(), fromIdentity: recipient(linkedinUrl), receivedAt: identity.received_at.toISOString() });
    expect((await db.query("SELECT state,stop_reason FROM campaign_enrolments WHERE id=$1", [enrolment.id])).rows[0]).toEqual({ state: "stopped", stop_reason: "reply_received" });
    expect(await processCampaignEnrolment(actor, enrolment.id)).toMatchObject({ outcome: "not_due" });
    expect((await db.query("SELECT count(*)::int n FROM campaign_contact_holds WHERE organization_id=$1", [org])).rows[0].n).toBe(0);
  });
});
