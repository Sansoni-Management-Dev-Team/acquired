import { beforeEach, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ step: vi.fn() }));
vi.mock("@/lib/campaign-service", () => ({ processN8nCampaignStep: mocked.step }));
import { POST } from "./route";

const body = { enrolmentId: "b74733ca-71e0-4595-afc4-559a3758f9ee", versionId: "b74733ca-71e0-4595-afc4-559a3758f9ef", stepIndex: 0 };
const request = (secret?: string, data: unknown = body) => new Request("https://app.test/api/internal/campaigns/step", { method: "POST", headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify(data) });
beforeEach(() => { vi.resetAllMocks(); process.env.OUTREACH_WORKER_SECRET = "test-secret"; mocked.step.mockResolvedValue({ outcome: "retry", nextStepAt: new Date() }); });

it("rejects unauthenticated and invalid callbacks", async () => {
  expect((await POST(request())).status).toBe(401);
  expect((await POST(request("wrong"))).status).toBe(401);
  expect((await POST(request("test-secret", { ...body, stepIndex: -1 }))).status).toBe(400);
  expect(mocked.step).not.toHaveBeenCalled();
});

it("accepts an authenticated step callback", async () => {
  expect((await POST(request("test-secret"))).status).toBe(200);
  expect(mocked.step).toHaveBeenCalledWith(body.enrolmentId, body.versionId, 0);
});

it("keeps the n8n execution waiting after a transient worker failure", async () => {
  mocked.step.mockRejectedValueOnce(new Error("Database unavailable"));
  const response = await POST(request("test-secret"));
  expect(response.status).toBe(200);
  expect((await response.json()).outcome).toBe("retry");
});
