import { beforeEach, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock("@/lib/campaign-service", () => ({ syncPublishedCampaignWorkflows: mocked.sync }));
import { POST } from "./route";

const request = (secret?: string) => new Request("https://app.test/api/internal/campaigns/sync", { method: "POST", headers: secret ? { Authorization: `Bearer ${secret}` } : {} });
beforeEach(() => { vi.resetAllMocks(); process.env.OUTREACH_WORKER_SECRET = "test-secret"; mocked.sync.mockResolvedValue({ synced: [] }); });

it("restricts workflow backfill to the authenticated worker", async () => {
  expect((await POST(request())).status).toBe(401);
  expect((await POST(request("wrong"))).status).toBe(401);
  expect(mocked.sync).not.toHaveBeenCalled();
  expect((await POST(request("test-secret"))).status).toBe(200);
  expect(mocked.sync).toHaveBeenCalledOnce();
});
