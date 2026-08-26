import { describe, expect, it, vi } from "vitest";
import { GmailMailbox, MockMailbox } from "./mailbox";

describe("mailboxes", () => {
  it("captures mock deliveries without an external send", async () => {
    const mailbox = new MockMailbox();
    await mailbox.send("u1", { to: "owner@example.invalid", subject: "Hello", text: "Body" });
    expect(mailbox.deliveries).toHaveLength(1);
  });

  it("builds and sends a Gmail MIME message", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(Buffer.from(body.raw, "base64url").toString()).toContain("Reply-To: deal-1@reply.example.com");
      return new Response(JSON.stringify({ id: "g1", threadId: "t1" }), { status: 200 });
    });
    const result = await new GmailMailbox(async () => "access", fetcher).send("u1", { to: "owner@example.com", subject: "Hello", text: "Body", replyTo: "deal-1@reply.example.com" });
    expect(result.providerMessageId).toBe("g1");
  });
});
