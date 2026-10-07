import { beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  run: vi.fn(), candidates: vi.fn(), stored: vi.fn(), progress: vi.fn(), update: vi.fn(), enrich: vi.fn(), save: vi.fn(),
}));
vi.mock("@/db/client", () => ({ requireDb: () => ({ select: () => ({ from: () => ({ where: async () => [] }) }) }) }));
vi.mock("@/db/firmable-history-repository", () => ({ FirmableHistoryRepository: class {
  run = mocks.run; searchCandidates = mocks.candidates; successfulPersonResponse = mocks.stored;
  profileProgress = mocks.progress; updateProgress = mocks.update;
} }));
vi.mock("@/adapters/provider-mode", () => ({ createTargetDataProvider: () => ({ firmable: { enrichPerson: mocks.enrich } }) }));
vi.mock("@/db/firmable-contacts", () => ({ upsertFirmableContact: mocks.save }));
import { refreshFirmableProfileBatch } from "./firmable-refresh";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.run.mockResolvedValue({ id: "run", trigger: "people", organizationId: "org", targetId: "target", firmableCompanyId: "company" });
  mocks.candidates.mockResolvedValue({ candidates: [{ id: "person" }] });
  mocks.stored.mockResolvedValue(undefined);
  mocks.progress.mockResolvedValue({ found: 1, saved: 1, failed: 0, pending: 0 });
  mocks.enrich.mockResolvedValue({ id: "person", name: "Alex", phone: "0400000000", phoneAvailable: true });
});

it("loads profiles without requesting phone unlocks and saves people for the list", async () => {
  expect(await refreshFirmableProfileBatch("run", 0)).toMatchObject({ saved: 1, complete: true });
  expect(mocks.enrich).toHaveBeenCalledWith({ id: "person" }, { includePhones: false });
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
    targetId: "target", person: expect.objectContaining({ name: "Alex", phone: undefined, phoneAvailable: false }),
  }));
});
