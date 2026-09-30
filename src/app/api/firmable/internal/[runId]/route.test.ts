import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/db/research-timing-repository", () => ({ saveResearchTimingSpans: vi.fn() }));

const mocks = vi.hoisted(() => ({ run: vi.fn(), company: vi.fn(), fail: vi.fn() }));
vi.mock("@/lib/research-service", () => ({ researchServiceAuthorized: () => true, researchEnabled: () => true }));
vi.mock("@/db/firmable-history-repository", () => ({ FirmableHistoryRepository: class { run = mocks.run; } }));
vi.mock("@/lib/firmable-refresh", () => ({
  refreshFirmableCompany: mocks.company,
  failFirmableRefresh: mocks.fail,
  refreshFirmablePeoplePage: vi.fn(),
  finalizeFirmablePeopleSearch: vi.fn(),
  refreshFirmableProfileBatch: vi.fn(),
  completeFirmableRefresh: vi.fn(),
}));

import { FirmableError } from "@/adapters/firmable-client";
import { POST } from "./route";

const runId = "00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ runId }) };
const request = () => new Request("https://app.example/api/firmable/internal/" + runId, {
  method: "POST",
  body: JSON.stringify({ action: "company", mandateId: "00000000-0000-4000-8000-000000000002" }),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.run.mockResolvedValue({ id: runId, status: "running" });
});

it.each([401, 402, 403])("persists a terminal account failure (%i) and acknowledges the step", async status => {
  mocks.company.mockRejectedValue(new FirmableError("/company", status, `Firmable request failed (${status})`));
  const response = await POST(request(), context);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ failed: true });
  expect(mocks.fail).toHaveBeenCalledWith(runId, `Firmable request failed (${status})`);
});

it("allows transient errors to reach the workflow retry policy", async () => {
  const error = new FirmableError("/company", 503, "Unavailable");
  mocks.company.mockRejectedValue(error);
  await expect(POST(request(), context)).rejects.toBe(error);
  expect(mocks.fail).not.toHaveBeenCalled();
});

it("does not call the provider again when a failed step is replayed", async () => {
  mocks.run.mockResolvedValue({ id: runId, status: "failed" });
  expect(await (await POST(request(), context)).json()).toEqual({ failed: true });
  expect(mocks.company).not.toHaveBeenCalled();
});
