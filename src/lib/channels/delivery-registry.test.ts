import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/campaign-whatsapp", () => ({
  assertCampaignWhatsappConnected: vi.fn(),
  campaignWhatsapp: vi.fn(),
  lookupCampaignWhatsapp: vi.fn(),
}));
vi.mock("@/lib/campaign-linkedin", () => ({
  assertLinkedinDeliveryReady: vi.fn(),
  campaignLinkedin: vi.fn(),
  lookupCampaignLinkedin: vi.fn(),
}));
import { campaignWhatsapp } from "@/lib/campaign-whatsapp";
import { campaignLinkedin } from "@/lib/campaign-linkedin";
import { deliveryProvider } from "./delivery-registry";
import { ReplyCheckPending } from "@/lib/campaign-reply-status";
import { GmailSendRejected } from "@/adapters/gmail-errors";
const input = {
  actor: { organizationId: "org", userId: "owner" },
  key: "campaign:enrol:step",
  recipient: "recipient",
  text: "Hello",
  messageId: "<receipt@example.invalid>",
};
afterEach(() => vi.clearAllMocks());
it.each(["email", "whatsapp", "linkedin"] as const)(
  "normalizes %s receipts through one contract",
  async (channel) => {
    vi.mocked(campaignWhatsapp).mockResolvedValue({
      id: "wa-id",
      status: "submitted",
      sentAt: new Date().toISOString(),
    });
    vi.mocked(campaignLinkedin).mockResolvedValue({
      action: { id: "li-id", status: "submitted" },
    });
    const mailbox = {
      send: vi
        .fn()
        .mockResolvedValue({
          providerMessageId: "email-id",
          providerThreadId: "thread",
          sentAt: new Date(),
        }),
    };
    const provider = deliveryProvider(channel, mailbox as never);
    const out = await provider.submit({ ...input, operation: "message" });
    expect(out.status).toBe("submitted");
    expect(out).toHaveProperty("id");
    expect(out).toHaveProperty("sentAt");
    expect(provider.channel).toBe(channel);
  },
);
it("keeps definite Gmail rejection retryable but never retries an ambiguous send", async () => {
  const mailbox = {
    send: vi
      .fn()
      .mockRejectedValue(
        new GmailSendRejected(new ReplyCheckPending("rate_limited", "email")),
      ),
  };
  const provider = deliveryProvider("email", mailbox as never);
  expect((await provider.submit(input)).status).toBe("waiting");
  mailbox.send.mockRejectedValue(
    new DOMException("lost response", "TimeoutError"),
  );
  await expect(provider.submit(input)).rejects.toThrow("lost response");
  expect(mailbox.send).toHaveBeenCalledTimes(2);
});
it("uses a stable key for WhatsApp campaign submission", async () => {
  vi.mocked(campaignWhatsapp).mockResolvedValue({
    id: "id",
    status: "submitted",
    sentAt: new Date().toISOString(),
  });
  await deliveryProvider("whatsapp").submit(input);
  expect(campaignWhatsapp).toHaveBeenCalledWith(input.actor, {
    key: input.key,
    recipient: input.recipient,
    text: input.text,
  });
});
