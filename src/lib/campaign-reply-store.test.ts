import {createHash} from 'node:crypto';
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ query: vi.fn(), rows: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/db/campaign-client", () => ({ rows: mock.rows, withCampaignWorker: (fn: (client: unknown) => unknown) => fn({ query: mock.query }), withCampaignDb: (_actor: unknown, fn: (client: unknown) => unknown) => fn({ query: mock.query }) }));
import { ingestCampaignReply, assertNoReplyHold, replayContactReplies, saveReplyIdentity } from "./campaign-reply-store";
const actor = { organizationId: "org", userId: "owner" };
const event = { id: "provider-1", fromIdentity: "alex@example.test", receivedAt: "2026-10-05T10:00:00Z" };
beforeEach(() => {
  vi.clearAllMocks(); process.env.CAMPAIGN_REPLY_MONITOR_MODE = "enforce";
  mock.query.mockResolvedValue({ rows: [], rowCount: 1 });
  mock.rows.mockImplementation(async (_client, sql: string) => {
    if (sql.includes("FROM member")) return [{ id: "member" }];
    if (sql.includes("FROM campaign_reply_identities")) return [{ contact_id: "contact", email: "alex@example.test", identity: event.fromIdentity, since: new Date("2026-10-01") }];
    return [];
  });
});
it.each(["email", "whatsapp", "linkedin"] as const)("a %s reply creates a contact hold and stops all channels for the person", async channel => {
  const fromIdentity = channel === "email" ? event.fromIdentity : channel === "whatsapp" ? "61412345678@s.whatsapp.net" : "urn:li:fsd_profile:alex";
  mock.rows.mockImplementation(async (_client, sql: string) => sql.includes("FROM member") ? [{ id: "member" }] : sql.includes("FROM campaign_reply_identities") ? [{ contact_id: "contact", email: "alex@example.test", identity: fromIdentity, since: new Date("2026-10-01") }] : []);
  expect(await ingestCampaignReply(actor, channel, "account", { ...event, fromIdentity })).toBe("stop");
  expect(mock.query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO campaign_reply_holds"))).toBe(true);
  const stop = mock.query.mock.calls.find(([sql]) => sql.includes("WITH stopped AS"))!;
  expect(stop[0]).toContain("organization_id = $1");
  expect(stop[0]).toContain("contact_id = ANY");
  expect(stop[0]).toContain("'active','paused','needs_review'");
  expect(stop[1]).toContain(channel);
});
it("does not assign old history or unrecognized identities to a contact", async () => {
  expect(await ingestCampaignReply(actor, "email", "account", { ...event, receivedAt: "2026-09-01T00:00:00Z" })).toBe("ignore");
  expect(mock.query.mock.calls.some(([sql]) => sql.includes("WITH stopped AS"))).toBe(false);
});
it("deduplicates events while replaying holds safely after an observation-to-enforcement rollout", async () => {
  mock.query.mockImplementation(async (sql: string) => ({ rows: [], rowCount: sql.startsWith("INSERT INTO campaign_inbound_events") ? 0 : 1 }));
  expect(await ingestCampaignReply(actor, "email", "account", event)).toBe("stop");
  expect(mock.query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO campaign_reply_receipts"))).toBe(true);
  expect(mock.query.mock.calls.find(([sql]) => sql.includes("WITH stopped AS"))![0]).toContain("stop_reason IS DISTINCT FROM $5");
});
it("observes replies without creating additional holds in observation mode", async () => {
  process.env.CAMPAIGN_REPLY_MONITOR_MODE = "observe";
  expect(await ingestCampaignReply(actor, "email", "account", event)).toBe("stop");
  expect(mock.query.mock.calls.some(([sql]) => sql.includes("campaign.reply_observed"))).toBe(true);
  expect(mock.query.mock.calls.some(([sql]) => sql.includes("WITH stopped AS") || sql.startsWith("INSERT INTO campaign_reply_holds"))).toBe(false);
});
it("rejects nonmembers and invalid channel identities without changing a contact", async () => {
  mock.rows.mockResolvedValue([]);
  await expect(ingestCampaignReply(actor, "email", "account", event)).rejects.toThrow("member");
  await expect(ingestCampaignReply(actor, "whatsapp", "account", event)).rejects.toThrow("identity");
  expect(mock.query.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(false);
});
it("blocks reenrolment by contact identity even after an email address changes", async () => {
  mock.rows.mockResolvedValue([{ reason: "reply_received" }]);
  await expect(assertNoReplyHold({ query: mock.query } as never, actor, "contact")).rejects.toThrow("reply_received");
  delete process.env.CAMPAIGN_REPLY_MONITOR_MODE;
  await assertNoReplyHold({ query: mock.query } as never, actor, "contact");
});

it('explicit service identity registration records canonical URL without changing legacy ingestion',async()=>{const profile='https://www.linkedin.com/in/person';await saveReplyIdentity(actor,{contactId:'contact',email:null,channel:'linkedin',identity:profile,sourceIdentity:profile,since:new Date('2026-10-01'),authority:'service'});expect(mock.query.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO campaign_reply_identities'))?.[1]).toContain(profile);await expect(ingestCampaignReply(actor,'linkedin','legacy-account',{...event,fromIdentity:profile})).rejects.toThrow('Invalid reply identity');});
it('replays authenticated original service URL receipts into holds during observation-to-enforcement rollout',async()=>{const profile='https://www.linkedin.com/in/person',b={application_id:'acquire',organization_id:'org',owner_user_id:'owner',service_connection_id:'original-connection',service_account_id:'original-account',generation:1,channel:'linkedin',platform:'linkedin',backend:'unipile',authority:'service'},account=createHash('sha256').update(JSON.stringify(['communications.account.binding.v1',['acquire','org','owner','original-connection','original-account',1,'linkedin','linkedin','unipile']])).digest('hex');mock.rows.mockImplementation(async(_c,sql:string)=>sql.includes('SELECT DISTINCT r.*')?[{channel:'linkedin',account_identity:account,provider_event_id:'service-source',from_identity:profile,received_at:new Date(event.receivedAt)}]:sql.includes('FROM public.communication_bindings')?[b]:sql.includes('FROM campaign_reply_identities')?[{contact_id:'contact',email:'',identity:profile,since:new Date('2026-10-01')}]:[]);await replayContactReplies(actor,'contact');expect(mock.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO campaign_reply_holds'))).toBe(true);});
