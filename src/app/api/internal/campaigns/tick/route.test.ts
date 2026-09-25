import { beforeEach, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ tick: vi.fn() }));
vi.mock("@/lib/campaign-service", () => ({ runCampaignTick: mocked.tick }));
import { POST } from "./route";

const request = (secret?: string) => new Request("https://app.test/api/internal/campaigns/tick", { method: "POST", headers: secret ? { Authorization: `Bearer ${secret}` } : {} });
beforeEach(() => { vi.resetAllMocks(); process.env.OUTREACH_WORKER_SECRET = "test-secret"; mocked.tick.mockResolvedValue({ processed: 0 }); });

it("rejects requests without the worker secret", async () => {
  expect((await POST(request())).status).toBe(401);
  expect((await POST(request("wrong"))).status).toBe(401);
  expect(mocked.tick).not.toHaveBeenCalled();
});

it("runs only for an authenticated worker", async () => {
  expect((await POST(request("test-secret"))).status).toBe(200);
  expect(mocked.tick).toHaveBeenCalledOnce();
});
