import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/campaign-whatsapp", () => ({ assertCampaignWhatsappConnected: vi.fn(), campaignWhatsapp: vi.fn(), lookupCampaignWhatsapp: vi.fn() }));
vi.mock("@/lib/campaign-linkedin", () => ({ assertLinkedinDeliveryReady: vi.fn(), campaignLinkedin: vi.fn(), lookupCampaignLinkedin: vi.fn() }));
import { campaignWhatsapp, lookupCampaignWhatsapp } from "@/lib/campaign-whatsapp";
import { campaignLinkedin } from "@/lib/campaign-linkedin";
import type { CampaignMailbox } from "@/lib/campaign-mailbox";
import type { ConnectionBinding, ConnectionRecord, MessageSubmission } from "../../../communications/packages/contracts/src/index";
import { messageDigest } from "../../../communications/packages/core/src/message-digest";
import { acquireLegacyAdapter } from "./communications-adapters";

const actor = { organizationId: "org", userId: "owner" };
function connection(channel: ConnectionBinding["channel"]): ConnectionRecord {
  return { binding: { applicationId: "acquire", tenantId: "org", ownerId: "owner", connectionId: `connection-${channel}`, accountId: `account-${channel}`, generation: 1, channel, platform: channel === "email" ? "gmail" : channel, backend: channel === "email" ? "direct" : channel === "whatsapp" ? "baileys" : "browser" }, status: "connected", capabilities: { messaging: { send: true, durableIdempotency: channel !== "email", receiptLookup: true }, events: { read: false, history: false, realtime: false }, ...(channel === "linkedin" ? { linkedin: { resolveProfile: true, relationships: true, invitations: true } } : {}) } };
}
function input(record: ConnectionRecord, operation: "message" | "invitation" = "message"): MessageSubmission {
  const recipient = record.binding.channel === "email" ? { kind: "email" as const, value: "recipient@example.invalid" } : record.binding.channel === "whatsapp" ? { kind: "phone" as const, value: "+61400000002" } : { kind: "linkedin_profile" as const, value: "https://www.linkedin.com/in/fictional-test" };
  const message = { recipient, text: operation === "invitation" ? "" : "Hello", ...(record.binding.channel === "email" ? { subject: "Subject", rfcMessageId: "<original@example.invalid>" } : {}) };
  return { snapshot: { binding: record.binding, key: "campaign:synthetic:step", operation, payloadDigest: messageDigest(operation, message) }, message };
}
beforeEach(() => vi.clearAllMocks());

it.each(["email", "whatsapp", "linkedin"] as const)("preserves existing %s submission through the new boundary", async channel => {
  const record = connection(channel);
  vi.mocked(campaignWhatsapp).mockResolvedValue({ status: "submitted", id: "wa", sentAt: "2026-10-12T00:00:00.000Z" });
  vi.mocked(campaignLinkedin).mockResolvedValue({ action: { status: "submitted", id: "li" } });
  const mailbox = { send: vi.fn().mockResolvedValue({ providerMessageId: "gmail", providerThreadId: "thread", sentAt: new Date("2026-10-12T00:00:00.000Z") }), findByRfcMessageId: vi.fn() } as unknown as CampaignMailbox;
  const value = input(record);
  expect(await acquireLegacyAdapter(actor, record, mailbox).submit(value)).toMatchObject({ status: "submitted", receipt: { [channel === "linkedin" ? "operation" : "message"]: { binding: record.binding }, recipient: value.message.recipient } });
  if (channel === "email") expect(mailbox.send).toHaveBeenCalledWith("owner", { to: value.message.recipient.value, subject: "Subject", text: "Hello", messageId: "<original@example.invalid>" });
  if (channel === "whatsapp") expect(campaignWhatsapp).toHaveBeenCalledWith(actor, { key: value.snapshot.key, recipient: "61400000002@s.whatsapp.net", text: "Hello" });
  if (channel === "linkedin") expect(campaignLinkedin).toHaveBeenCalledWith(actor, { operation: "message", profile: value.message.recipient.value, key: value.snapshot.key, text: "Hello" });
});
it("uses the existing invitation implementation", async () => {
  const record = connection("linkedin");
  vi.mocked(campaignLinkedin).mockResolvedValue({ action: { status: "skipped", id: "already-connected" } });
  expect(await acquireLegacyAdapter(actor, record).submit(input(record, "invitation"))).toMatchObject({ status: "skipped" });
  expect(campaignLinkedin).toHaveBeenCalledWith(actor, expect.objectContaining({ operation: "connect", text: "" }));
});
it.each([{ organizationId: "other", userId: "owner" }, { organizationId: "org", userId: "other" }])("rejects wrong ownership before selecting any backend", wrong => {
  expect(() => acquireLegacyAdapter(wrong, connection("whatsapp"))).toThrow("forbidden");
  expect(campaignWhatsapp).not.toHaveBeenCalled();
});
it("does not route an Unipile binding to a legacy provider", () => {
  const record = connection("whatsapp");
  expect(() => acquireLegacyAdapter(actor, { ...record, binding: { ...record.binding, backend: "unipile" } })).toThrow();
  expect(campaignWhatsapp).not.toHaveBeenCalled();
});
it("preserves disconnected original connection receipt recovery without submitting", async () => {
  const record = { ...connection("whatsapp"), status: "disconnected" as const };
  vi.mocked(lookupCampaignWhatsapp).mockResolvedValue({ status: "submitted", id: "original", sentAt: "2026-10-12T00:00:00.000Z" });
  const value = input(record);
  expect(await acquireLegacyAdapter(actor, record).lookup({ snapshot: value.snapshot, expectedRecipient: value.message.recipient })).toMatchObject({ status: "submitted", receipt: { message: { binding: record.binding, id: "original" } } });
  expect(lookupCampaignWhatsapp).toHaveBeenCalledWith(actor, value.snapshot.key);
  expect(campaignWhatsapp).not.toHaveBeenCalled();
});
it("keeps Gmail unready without an authorized injected mailbox", async () => {
  const record = connection("email");
  expect(await acquireLegacyAdapter(actor, record).submit(input(record))).toEqual({ status: "review", code: "reconnect" });
});
