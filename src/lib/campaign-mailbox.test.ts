import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mock = vi.hoisted(() => ({ live: vi.fn() }));
vi.mock("@/lib/gmail-connection", () => ({ connectionCanMonitorReplies: () => true, mailboxForConnection: mock.live }));
import { campaignMailboxForConnection, campaignTestSendAnytime } from "./campaign-mailbox";
const grant = { encryptedRefreshToken: "fixture", reconnectRequired: false, scopes: [] };
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("LOCAL_DEVELOPMENT", "true"); vi.stubEnv("DATABASE_URL", "postgresql://fixture:fixture@127.0.0.1:5434/project_acquire"); vi.stubEnv("CAMPAIGN_TEST_SINK_URL", "http://127.0.0.1:18094/"); vi.stubEnv("CAMPAIGN_TEST_SEND_ANYTIME", "true"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it.each([
  ["NODE_ENV", "production"], ["LOCAL_DEVELOPMENT", "false"], ["DATABASE_URL", "postgresql://localhost:5434/project_acquire"],
  ["DATABASE_URL", "postgresql://127.0.0.1:5432/project_acquire"], ["DATABASE_URL", "postgresql://127.0.0.1:5434/production"],
  ["CAMPAIGN_TEST_SINK_URL", "https://127.0.0.1:18094/"], ["CAMPAIGN_TEST_SINK_URL", "http://evil.test:18094/"], ["CAMPAIGN_TEST_SINK_URL", "http://127.0.0.1:18094/send"],
])("rejects unsafe sink configuration %s=%s without falling back to Gmail", (key, value) => {
  vi.stubEnv(key, value); expect(() => campaignMailboxForConnection(grant, "mailbox")).toThrow("dedicated local"); expect(mock.live).not.toHaveBeenCalled(); expect(() => campaignTestSendAnytime()).toThrow();
});
it("fast-send flags alone cannot activate local delivery", () => { vi.stubEnv("CAMPAIGN_TEST_SINK_URL", ""); expect(campaignTestSendAnytime()).toBe(false); });
it("sink delivery never accesses the live mailbox and preserves provider timestamps", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ providerMessageId: "sink-id", providerThreadId: "thread", sentAt: "2026-10-06T01:00:00Z" })); vi.stubGlobal("fetch", fetch);
  const message = { to: "synthetic@example.invalid", subject: "Hello", text: "Test", messageId: "test-id" };
  expect(await campaignMailboxForConnection(grant, "mailbox").send("owner", message)).toEqual({ providerMessageId: "sink-id", providerThreadId: "thread", sentAt: new Date("2026-10-06T01:00:00Z") });
  expect(String(fetch.mock.calls[0][0])).toBe("http://127.0.0.1:18094/send"); expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ mailboxId: "mailbox", userId: "owner", message }); expect(mock.live).not.toHaveBeenCalled();
});
it("sink outages fail without live fallback or automatic retry", async () => { const fetch = vi.fn().mockRejectedValue(new Error("sink offline")); vi.stubGlobal("fetch", fetch); await expect(campaignMailboxForConnection(grant, "mailbox").send("owner", { to: "test@example.invalid", subject: "Hi", text: "Test", messageId: "id" })).rejects.toThrow("sink offline"); expect(fetch).toHaveBeenCalledOnce(); expect(mock.live).not.toHaveBeenCalled(); });
