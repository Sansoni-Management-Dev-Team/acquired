import { describe, expect, it, vi } from "vitest";
import { GmailMailbox, type MailboxAdapter, type OutboundMessage } from "./mailbox";

class TestMailbox implements MailboxAdapter {
  deliveries: Array<{ userId: string; message: OutboundMessage }> = [];

  async send(userId: string, message: OutboundMessage) {
    this.deliveries.push({ userId, message });
    return { providerMessageId: "test-1", providerThreadId: message.threadId || "test-1", sentAt: new Date() };
  }
}

describe("mailboxes", () => {
  it("captures test deliveries without an external send", async () => {
    const mailbox = new TestMailbox();
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
    const subject = "ARK Industrial – Facilities Management";
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer access" });
      const body = JSON.parse(String(init?.body));
      expect(Buffer.from(body.message.raw, "base64url").toString()).toContain("To: owner@example.com");
      expect(Buffer.from(body.message.raw, "base64url").toString()).toContain(`Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`);
      expect(Buffer.from(body.message.raw, "base64url").toString()).toContain("Content-Transfer-Encoding: 8bit");
      return new Response(JSON.stringify({ id: "d1", message: { id: "g1", threadId: "t1" } }), { status: 200 });
    });
    const result = await new GmailMailbox(async () => "access", fetcher).createDraft("u1", { to: "owner@example.com", subject, text: "Body" });
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

  it("holds a send if Gmail already has a conversation", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const query = new URL(String(url)).searchParams.get("q");
      return new Response(JSON.stringify({ messages: query?.includes("from:") ? [{ id: "existing", threadId: "thread" }] : [] }), { status: 200 });
    });
    await expect(new GmailMailbox(async () => "access", fetcher).hasConversation("A@Example.com")).resolves.toBe(true);
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("q")).toContain("a@example.com");
  });

  it("fails closed when Gmail cannot check prior conversations", async () => {
    const mailbox = new GmailMailbox(async () => "access", vi.fn(async () => new Response(null, { status: 403 })));
    await expect(mailbox.hasConversation("a@example.com")).rejects.toThrow("conversation check failed");
  });

  it("places a stable Message-ID on outbound Gmail mail", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const raw = Buffer.from(JSON.parse(String(init?.body)).raw, "base64url").toString();
      expect(raw).toContain("Message-ID: <attempt@acquire.mlai.au>");
      return new Response(JSON.stringify({ id: "sent", threadId: "thread" }), { status: 200 });
    });
    await new GmailMailbox(async () => "access", fetcher).send("owner", { to: "a@example.com", subject: "Hello", text: "Hi", messageId: "<attempt@acquire.mlai.au>" });
  });

  it("finds outbound mail for a final manual-conversation check", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      expect(new URL(String(url)).searchParams.get("q")).toContain("to:a@example.com");
      return new Response(JSON.stringify({ messages: [{ id: "manual-1", threadId: "thread-1" }] }), { status: 200 });
    });
    await expect(new GmailMailbox(async () => "access", fetcher).outboundToSince("A@Example.com", new Date("2026-09-25T00:00:00Z"))).resolves.toEqual(["manual-1"]);
  });

  it("checks every Gmail search page before clearing outbound history", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const page = new URL(String(url)).searchParams.get("pageToken");
      return new Response(JSON.stringify(page ? { messages: [{ id: "second", threadId: "t2" }] } : { messages: [{ id: "first", threadId: "t1" }], nextPageToken: "next" }), { status: 200 });
    });
    await expect(new GmailMailbox(async () => "access", fetcher).outboundToSince("a@example.com", new Date())).resolves.toEqual(["first", "second"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails closed if Gmail history cannot be fully paginated", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ messages: [], nextPageToken: "more" }), { status: 200 }));
    await expect(new GmailMailbox(async () => "access", fetcher).outboundToSince("a@example.com", new Date())).rejects.toThrow("safety-check limit");
  });
});
