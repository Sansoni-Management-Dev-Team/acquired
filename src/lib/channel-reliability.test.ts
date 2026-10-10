import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assertCampaignWhatsappConnected } from "./campaign-whatsapp";
import { readChannelReplies } from "./campaign-reply-providers";
import { GmailMailbox } from "@/adapters/mailbox";
import { refreshGoogleAccessToken } from "./google-oauth";
const actor = { organizationId: "org", userId: "owner" };
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it.each(["connecting", "reconnecting"])(
  "waits for WhatsApp %s without requesting human reconnection",
  async (status) => {
    vi.stubEnv("WHATSAPP_SERVICE_URL", "http://localhost:18125");
    vi.stubEnv("WHATSAPP_SERVICE_SECRET", "fixture");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ status })),
    );
    await expect(assertCampaignWhatsappConnected(actor)).rejects.toMatchObject({
      code: "incomplete",
      channel: "whatsapp",
      retryAt: expect.any(Date),
    });
  },
);
it("keeps a WhatsApp inbox synchronization wait retryable", async () => {
  vi.stubEnv("WHATSAPP_SERVICE_URL", "http://localhost:18125");
  vi.stubEnv("WHATSAPP_SERVICE_SECRET", "fixture");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          {
            detail: {
              code: "incomplete",
              retryAt: new Date(Date.now() + 60000).toISOString(),
            },
          },
          { status: 409 },
        ),
      ),
  );
  await expect(
    readChannelReplies(actor, "whatsapp", null),
  ).rejects.toMatchObject({ code: "incomplete", retryAt: expect.any(Date) });
});
it.each(["userRateLimitExceeded", "rateLimitExceeded"])(
  "waits for Gmail %s rather than reconnecting",
  async (reason) => {
    const mailbox = new GmailMailbox(
      async () => "token",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { errors: [{ reason }] } },
            { status: 403, headers: { "Retry-After": "120" } },
          ),
        ),
    );
    await expect(
      mailbox.inboundFrom("a@example.invalid", new Date(0)),
    ).rejects.toMatchObject({
      code: "rate_limited",
      channel: "email",
      retryAt: expect.any(Date),
    });
  },
);
it("keeps a token server outage retryable", async () => {
  await expect(
    refreshGoogleAccessToken(
      "fixture",
      vi.fn().mockResolvedValue(Response.json({}, { status: 503 })),
    ),
  ).rejects.toMatchObject({ code: "unavailable", channel: "email" });
});
it("holds an explicitly revoked Gmail token for reconnection", async () => {
  await expect(
    refreshGoogleAccessToken(
      "fixture",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "invalid_grant" }, { status: 400 }),
        ),
    ),
  ).rejects.toMatchObject({ code: "reconnect", channel: "email" });
});

it("classifies a confirmed Gmail send quota rejection without treating it as accepted", async () => {
  const { GmailMailbox } = await import("@/adapters/mailbox");
  const mailbox = new GmailMailbox(
    async () => "token",
    async () =>
      new Response("{}", { status: 429, headers: { "retry-after": "60" } }),
  );
  await expect(
    mailbox.send("owner", {
      to: "test@example.invalid",
      subject: "Test",
      text: "Test",
    }),
  ).rejects.toMatchObject({ failure: { code: "rate_limited" } });
});
