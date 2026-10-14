import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const mock = vi.hoisted(() => ({ rows: vi.fn(), query: vi.fn(), conversation: vi.fn(), ready: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/db/campaign-client", () => ({ rows: mock.rows, withCampaignDb: (_actor: unknown, callback: (client: unknown) => unknown) => callback({ query: mock.query }), withCampaignWorker: vi.fn() }));
vi.mock("@/test/fixtures/gmail-connection", () => ({ connectionCanMonitorReplies: () => true }));
vi.mock("@/test/fixtures/campaign-mailbox", () => ({ campaignTestSendAnytime: () => true, campaignMailboxForConnection: () => ({ hasConversation: mock.conversation }) }));
vi.mock("@/lib/campaign-n8n", () => ({ n8nCampaignEnabled: () => true }));
vi.mock("@/lib/channels/delivery-registry", () => ({ deliveryProvider: () => ({ ready: mock.ready }) }));
import { enrolContacts as legacyEnrolContacts } from '@/test/fixtures/legacy-campaign-service';
import { enrolContacts, createMandateContact } from "./campaign-service";
const actor = { organizationId: "org", userId: "owner" }; const contactId = randomUUID(); const sequenceId = randomUUID();
let recipientDetails: Record<string, unknown>;
let failure: string | null, kind: "email" | "whatsapp" | "linkedin", existing: boolean, contacts: number;
beforeEach(() => {
  vi.resetAllMocks();vi.stubEnv("COMMUNICATIONS_RUNTIME_ENABLED","true"); vi.stubEnv("CAMPAIGN_REPLY_MONITOR_MODE", "off"); failure = null; kind = "email"; existing = false; contacts = 0; recipientDetails = {};
  mock.query.mockResolvedValue({ rows: [], rowCount: 1 }); mock.ready.mockResolvedValue(undefined); mock.conversation.mockImplementation(async () => existing);
  mock.rows.mockImplementation(async (_client, sql: string, values: unknown[]) => {
    if (sql.startsWith("SELECT id FROM mandates")) return [{ id: "mandate" }];
    if (sql.startsWith("INSERT INTO contacts")) return [{ id: contactId }];
    if (sql.startsWith("SELECT * FROM campaign_sequences")) return failure === "missing-sequence" ? [] : [{ id: sequenceId, mandate_id: "mandate", published_version: failure === "unpublished" ? 0 : 1 }];
    if (sql.includes("FROM campaign_sequence_versions")) return failure === "missing-version" ? [] : [{ id: "version", version: 1, n8n_workflow_id: failure === "unsynced" ? null : "workflow", definition: { schemaVersion: 1, steps: [{ id: randomUUID(), kind, title: "Intro", body: "Hi", ...(kind === "email" ? { subject: "Hello" } : {}) }] } }];
    if (sql.includes("FROM mailbox_connections")) return failure === "mailbox" ? [] : [{ id: "mailbox" }];
    if (sql.includes("FROM contacts")) { contacts++; return failure === "foreign-contact" ? [] : [{ id: values[0], display_name: "Alex", fictionalised: failure === "fictionalised", personal_data: { email: failure === "bad-email" ? "not-an-email" : failure === "same-email" ? "SAME@example.test" : `${values[0]}@example.test`, doNotContact: failure === "do-not-contact", ...recipientDetails } }]; }
    if (sql.includes("FROM suppressions")) return failure === "suppression" ? [{ reason: "suppressed" }] : [];
    if (sql.includes("FROM campaign_contact_holds")) return failure === "hold" ? [{ reason: "reply_received" }] : [];
    if (sql.includes("FROM campaign_enrolments") && sql.startsWith("SELECT id")) return failure === "running" ? [{ id: "already-enrolled" }] : [];
    if (sql.includes("FROM campaign_contact_assignments")) return failure === "other-sender" ? [] : [{ id: "assignment" }];
    if (sql.startsWith("INSERT INTO campaign_enrolments")) return [{ id: "enrolment", state: values[8], next_step_at: values[10] }];
    return [];
  });
});
afterEach(() => vi.unstubAllEnvs());
it.each(["missing-sequence", "unpublished", "missing-version", "unsynced", "mailbox", "foreign-contact", "fictionalised", "bad-email", "do-not-contact", "suppression", "hold", "running"])("enrolment refuses %s before inserting or provider work", async value => {
  failure = value; if(value === "mailbox") vi.stubEnv("COMMUNICATIONS_RUNTIME_ENABLED","false"); await expect((value === "mailbox" ? legacyEnrolContacts : enrolContacts)(actor, sequenceId, [contactId])).rejects.toThrow(); expect(mock.conversation).not.toHaveBeenCalled(); expect(mock.query).not.toHaveBeenCalled();
});
it.each(["whatsapp", "linkedin"] as const)("enrolment refuses missing %s recipient details before provider work", async channel => { kind = channel; await expect(enrolContacts(actor, sequenceId, [contactId])).rejects.toThrow(); expect(mock.conversation).not.toHaveBeenCalled(); expect(mock.query).not.toHaveBeenCalled(); });
it("deduplicates repeated contact IDs before conversation checks and insertions", async () => {
  const result = await enrolContacts(actor, sequenceId, [contactId, contactId, contactId]); expect(result).toHaveLength(1); expect(contacts).toBe(1); expect(mock.conversation).not.toHaveBeenCalled(); expect(mock.rows.mock.calls.filter(([,sql]) => sql.startsWith("INSERT INTO campaign_enrolments"))).toHaveLength(1);
});
it("rejects different contacts sharing one normalized email", async () => { failure = "same-email"; await expect(enrolContacts(actor, sequenceId, [contactId, randomUUID()])).rejects.toThrow("same email"); expect(mock.conversation).not.toHaveBeenCalled(); });
it("does not steal an assignment from another sender", async () => { failure = "other-sender"; await expect(enrolContacts(actor, sequenceId, [contactId])).rejects.toThrow("another sender"); expect(mock.rows.mock.calls.some(([,sql]) => sql.startsWith("INSERT INTO campaign_enrolments"))).toBe(false); });
it("holds prior conversations instead of scheduling the first send", async () => { vi.stubEnv("COMMUNICATIONS_RUNTIME_ENABLED","false"); existing = true; const result = await legacyEnrolContacts(actor, sequenceId, [contactId]); expect(result[0]).toMatchObject({ state: "needs_review", nextStepAt: null }); const params = mock.rows.mock.calls.find(([,sql]) => sql.startsWith("INSERT INTO campaign_enrolments"))![2]; expect(params[9]).toBe("existing_conversation"); });
it("provider preflight failure cannot create a partially checked batch", async () => { vi.stubEnv("COMMUNICATIONS_RUNTIME_ENABLED","false"); mock.conversation.mockRejectedValue(new Error("history unavailable")); await expect(legacyEnrolContacts(actor, sequenceId, [contactId, randomUUID()])).rejects.toThrow("history unavailable"); expect(mock.query).not.toHaveBeenCalled(); });

it("subscribes a LinkedIn-only contact without email, name, company or Gmail", async () => {
  kind = "linkedin"; failure = "mailbox"; recipientDetails = { email: null, linkedinUrl: "https://au.linkedin.com/in/alex/?tracking=1" };
  expect(await enrolContacts(actor, sequenceId, [contactId])).toHaveLength(1);
  expect(mock.conversation).not.toHaveBeenCalled();
  expect(mock.rows.mock.calls.some(([,sql]) => sql.includes("FROM mailbox_connections"))).toBe(false);
  const values = mock.rows.mock.calls.find(([,sql]) => sql.startsWith("INSERT INTO campaign_enrolments"))![2];
  expect(values[6]).toBeNull(); expect(values[7]).toBeNull(); expect(values[15]).toBe("https://www.linkedin.com/in/alex");
});
it("rejects duplicate LinkedIn profiles across host, query and trailing-slash variants", async () => {
  kind = "linkedin"; recipientDetails = { email: null, linkedinUrl: "https://www.linkedin.com/in/alex/" };
  await expect(enrolContacts(actor, sequenceId, [contactId, randomUUID()])).rejects.toThrow("same LinkedIn profile");
  expect(mock.rows.mock.calls.some(([,sql]) => sql.startsWith("INSERT INTO campaign_enrolments"))).toBe(false);
});
it("creates a person with no personal fields and a direct mandate link", async () => {
  expect(await createMandateContact(actor, "mandate", {})).toEqual({ id: contactId });
  const values = mock.rows.mock.calls.find(([,sql]) => sql.startsWith("INSERT INTO contacts"))![2];
  expect(values.slice(0,4)).toEqual(["org", "mandate", "", null]);
  expect(JSON.parse(values[4])).toMatchObject({ email: null, linkedinUrl: null, phone: null, companyName: null });
});

it('configured email enrollment freezes service defaults without requiring retired Gmail credentials',async()=>{vi.stubEnv('COMMUNICATIONS_RUNTIME_ENABLED','true');failure='mailbox';const result=await enrolContacts(actor,sequenceId,[contactId]);expect(result).toHaveLength(1);expect(mock.rows.mock.calls.some(([,sql])=>sql.includes('FROM mailbox_connections'))).toBe(false);expect(mock.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO public.campaign_channel_bindings'))).toBe(true);expect(result[0].state).toBe('needs_review');expect(mock.ready).toHaveBeenCalledOnce();expect(mock.conversation).not.toHaveBeenCalled();});
it('configured enrollment cannot continue without a persisted same-owner service binding',async()=>{vi.stubEnv('COMMUNICATIONS_RUNTIME_ENABLED','true');const old=mock.query.getMockImplementation()!;mock.query.mockImplementation((sql,...args)=>sql.startsWith('INSERT INTO public.campaign_channel_bindings')?Promise.resolve({rows:[],rowCount:0}):old(sql,...args));await expect(enrolContacts(actor,sequenceId,[contactId])).rejects.toThrow('recorded');});

it('configured LinkedIn enrollment records canonical person identity in its frozen owner transaction',async()=>{vi.stubEnv('COMMUNICATIONS_RUNTIME_ENABLED','true');kind='linkedin';recipientDetails={email:null,linkedinUrl:'https://www.linkedin.com/in/alex/'};await enrolContacts(actor,sequenceId,[contactId]);const write=mock.query.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO public.campaign_reply_identities'));expect(write).toBeDefined();expect(write![1]).toContain('https://www.linkedin.com/in/alex');});
