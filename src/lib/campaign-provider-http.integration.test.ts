import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
vi.mock("server-only", () => ({}));
import { campaignLinkedin, campaignLinkedinAccountStatus } from "@/lib/campaign-linkedin";
import { campaignWhatsapp, assertCampaignWhatsappConnected } from "@/lib/campaign-whatsapp";
import { readChannelReplies } from "@/lib/campaign-reply-providers";

// Real HTTP on an ephemeral loopback port. This server never forwards requests
// or knows provider credentials. It records writes to synthetic recipients only.
describe("campaign provider HTTP integration", () => {
  const actor = { organizationId: "http-test-org", userId: "http-test-user" };
  const profile = "https://www.linkedin.com/in/synthetic-integration-fixture/";
  const recipient = "61400000000@s.whatsapp.net";
  const calls: { url: URL; method: string; authorization: string | undefined; body: Record<string, unknown> }[] = [];
  let answer: (request: IncomingMessage, response: ServerResponse) => void;
  const json = (response: ServerResponse, value: unknown) => { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const parsed = body ? JSON.parse(body) : {};
    if (parsed.profile && parsed.profile !== profile || parsed.recipient && parsed.recipient !== recipient) { response.writeHead(403).end(); return; }
    calls.push({ url: new URL(request.url!, "http://localhost"), method: request.method!, authorization: request.headers.authorization, body: parsed });
    answer(request, response);
  });
  beforeAll(async () => {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    vi.stubEnv("CAMPAIGN_LINKEDIN_ENABLED", "true");
    for (const channel of ["LINKEDIN", "WHATSAPP"]) {
      vi.stubEnv(`${channel}_SERVICE_URL`, base);
      vi.stubEnv(`${channel}_SERVICE_SECRET`, "synthetic-http-secret");
    }
  });
  beforeEach(() => { calls.length = 0; });
  afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); vi.unstubAllEnvs(); });
  it("scopes actual account requests and authenticates both adapters", async () => {
    answer = (_, response) => json(response, { status: "connected" });
    expect(await campaignLinkedinAccountStatus(actor)).toBe("connected");
    await assertCampaignWhatsappConnected(actor);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.url.searchParams.get("organizationId")).toBe(actor.organizationId);
      expect(call.url.searchParams.get("userId")).toBe(actor.userId);
      expect(call.authorization).toBe("Bearer synthetic-http-secret");
    }
  });
  it("round-trips a skipped existing connection and a submitted message", async () => {
    answer = (_, response) => json(response, { connected: true, recipient: "urn:li:fsd_profile:synthetic", action: { id: "synthetic-action", status: calls.at(-1)?.body.operation === "connect" ? "skipped" : "submitted", attemptedAt: Date.now() / 1000 } });
    expect((await campaignLinkedin(actor, { operation: "connect", profile, key: "synthetic-connect", text: "" })).action?.status).toBe("skipped");
    expect((await campaignLinkedin(actor, { operation: "message", profile, key: "synthetic-message", text: "Hello fixture" })).action?.status).toBe("submitted");
    expect(calls.map(call => call.body.key)).toEqual(["synthetic-connect", "synthetic-message"]);
  });
  it("round-trips a WhatsApp write without altering Unicode text", async () => {
    answer = (_, response) => json(response, { id: "synthetic-message", recipient, status: "submitted" });
    const text = "Hello 👩🏽‍💻\nمرحبا {{literal}}";
    expect((await campaignWhatsapp(actor, { recipient, text })).id).toBe("synthetic-message");
    expect(calls[0].body).toEqual({ recipient, text });
  });
  it.each(["linkedin", "whatsapp"] as const)("rejects a %s redirect without forwarding the write", async channel => {
    answer = (_, response) => { response.writeHead(307, { Location: "/unexpected-write" }); response.end(); };
    await expect(channel === "linkedin" ? campaignLinkedin(actor, { operation: "message", profile, key: "redirect", text: "fixture" }) : campaignWhatsapp(actor, { recipient, text: "fixture" })).rejects.toThrow();
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).not.toBe("/unexpected-write");
  });
  it.each(["linkedin", "whatsapp"] as const)("does not retry %s when the socket closes after reading a write", async channel => {
    answer = request => request.socket.destroy();
    await expect(channel === "linkedin" ? campaignLinkedin(actor, { operation: "message", profile, key: "lost-response", text: "fixture" }) : campaignWhatsapp(actor, { recipient, text: "fixture" })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
  it.each(["linkedin", "whatsapp"] as const)("preserves a %s reply cursor over HTTP", async channel => {
    const checkedAt = new Date().toISOString(), cursor = "cursor:+/&?✓";
    answer = (_, response) => json(response, { accountIdentity: "synthetic-account", events: [], nextCursor: cursor, complete: true, checkedAt });
    expect((await readChannelReplies(actor, channel, cursor, new Date(0))).nextCursor).toBe(cursor);
    expect(calls[0].url.searchParams.get("cursor")).toBe(cursor);
    if (channel === "linkedin") expect(calls[0].url.searchParams.get("background")).toBe("true");
  });
});
