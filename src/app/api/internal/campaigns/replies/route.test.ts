import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ ingest: vi.fn() }));
vi.mock("@/lib/campaign-reply-store", () => ({ ingestCampaignReply: mock.ingest }));
import { POST } from "./route";
const body = { organizationId: "org", userId: "owner", channel: "whatsapp", accountIdentity: "account", event: { id: "id", fromIdentity: "61412345678@s.whatsapp.net", receivedAt: new Date().toISOString() } };
const request = (secret = "secret", data: unknown = body) => new Request("https://app.test/api/internal/campaigns/replies", { method: "POST", headers: { Authorization: `Bearer ${secret}` }, body: JSON.stringify(data) });
beforeEach(() => { vi.stubEnv("OUTREACH_WORKER_SECRET", "secret"); mock.ingest.mockReset(); mock.ingest.mockResolvedValue("stop"); });
afterEach(() => vi.unstubAllEnvs());
it("authenticates before consuming an event and rejects invalid payloads", async () => {
  expect((await POST(request("wrong"))).status).toBe(401);
  expect((await POST(request("secret", { ...body, channel: "sms" }))).status).toBe(400);
  expect((await POST(request("secret", { ...body, contactId: "arbitrary" }))).status).toBe(400);
  expect(mock.ingest).not.toHaveBeenCalled();
});
it("acknowledges a durable event only after the transaction succeeds", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(mock.ingest).toHaveBeenCalledWith({ organizationId: "org", userId: "owner" }, "whatsapp", "account", body.event);
  mock.ingest.mockRejectedValue(new Error("Database offline"));
  expect((await POST(request())).status).toBe(503);
});
it("rejects large bodies and invalid dates without an acknowledgement", async () => {
  expect((await POST(request("secret", { ...body, event: { ...body.event, receivedAt: "invalid" } }))).status).toBe(400);
  expect((await POST(request("secret", { extra: "x".repeat(17000) }))).status).toBe(413);
});
