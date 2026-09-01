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

  it("creates a Gmail draft without sending it", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer access" });
      const body = JSON.parse(String(init?.body));
      expect(Buffer.from(body.message.raw, "base64url").toString()).toContain("To: owner@example.com");
      expect(Buffer.from(body.message.raw, "base64url").toString()).toContain("Subject: Hello");
      return new Response(JSON.stringify({ id: "d1", message: { id: "g1", threadId: "t1" } }), { status: 200 });
    });
    const result = await new GmailMailbox(async () => "access", fetcher).createDraft("u1", { to: "owner@example.com", subject: "Hello", text: "Body" });
    expect(result).toEqual({ providerDraftId: "d1", providerMessageId: "g1", providerThreadId: "t1" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("updates and deletes a Gmail draft without sending it", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      expect(String(url).endsWith("/drafts/draft%2F1")).toBe(true);
      return new Response(JSON.stringify({ id: "draft/1", message: { id: "g2", threadId: "t1" } }), { status: 200 });
    });
    const mailbox = new GmailMailbox(async () => "access", fetcher);
    await expect(mailbox.updateDraft("draft/1", { to: "owner@example.com", subject: "Updated", text: "Body" })).resolves.toMatchObject({ providerDraftId: "draft/1" });
    await expect(mailbox.deleteDraft("draft/1")).resolves.toBeUndefined();
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(["PUT", "DELETE"]);
  });
});
