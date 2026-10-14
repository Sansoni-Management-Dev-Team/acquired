import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ step: vi.fn(), tick: vi.fn(), sync: vi.fn(), ingest: vi.fn() }));
vi.mock("@/lib/campaign-service", () => ({ processN8nCampaignStep: mock.step, runCampaignTick: mock.tick, syncPublishedCampaignWorkflows: mock.sync }));
vi.mock("@/lib/campaign-reply-store", () => ({ ingestCampaignReply: mock.ingest }));
import { POST as step } from "./step/route";
import { POST as tick } from "./tick/route";
import { POST as sync } from "./sync/route";
import { POST as reply } from "./replies/route";
const secret = "fixture-worker-secret";
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("OUTREACH_WORKER_SECRET", secret); });
afterEach(() => vi.unstubAllEnvs());
for (const [name, handler] of [["step", step], ["tick", tick], ["sync", sync], ["reply", reply]] as const) {
  it.each([secret, `Basic ${secret}`, "Bearer incorrect", "Bearer", `Bearer ${secret}extra`, ""])(`${name} rejects authorization %s before service access`, async authorization => {
    const response = await handler(new Request("https://app.test/api/internal/test", { method: "POST", headers: { authorization }, body: "{}" })); expect(response.status).toBe(401); Object.values(mock).forEach(fn => expect(fn).not.toHaveBeenCalled());
  });
  it(`${name} rejects empty configured secret`, async () => { vi.stubEnv("OUTREACH_WORKER_SECRET", ""); const response = await handler(new Request("https://app.test/api/internal/test", { method: "POST", headers: { authorization: `Bearer ${secret}` }, body: "{}" })); expect(response.status).toBe(401); });
}
it.each([-1, 25, 1.5, "0", null])("step rejects hostile index %s", async stepIndex => { const response = await step(new Request("https://app.test", { method: "POST", headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify({ enrolmentId: "593e2dd1-42a6-4423-a913-1bccb3a320ba", versionId: "8acc969c-4c7e-4d25-9f51-84514f2bc3de", stepIndex }) })); expect(response.status).toBe(400); expect(mock.step).not.toHaveBeenCalled(); });

it('does not expose worker exception details to the caller', async () => {
 mock.tick.mockRejectedValue(Error('private-database-host provider-secret synthetic'));
 const response = await tick(new Request('https://app.test/api/internal/campaigns/tick', { method: 'POST', headers: { authorization: `Bearer ${secret}` } }));
 expect(response.status).toBe(500);
 expect(await response.json()).toEqual({error:'Worker failed'});
});
