import { beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  run: vi.fn(), candidates: vi.fn(), stored: vi.fn(), progress: vi.fn(), update: vi.fn(), enrich: vi.fn(), save: vi.fn(),
}));
vi.mock("@/db/client", () => ({ requireDb: () => ({ select: () => ({ from: () => ({ where: async () => [] }) }) }) }));
vi.mock("@/db/firmable-history-repository", () => ({ FirmableHistoryRepository: class {
  run = mocks.run; searchCandidates = mocks.candidates; successfulPersonResponse = mocks.stored;
  profileProgress = mocks.progress; updateProgress = mocks.update; reconcileProfileProgress = mocks.progress;
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
it('RC-11-regression: an admitted batch reconciles each individual write before aggregate settlement', async () => {
  mocks.candidates.mockResolvedValue({ candidates: [{ id: 'a' }, { id: 'b' }] });
  let resolveSlow!: (value: unknown) => void;
  mocks.enrich.mockImplementation(({id}: {id:string}) => id==='a' ? Promise.resolve({id,name:'Synthetic Owner'}) : new Promise(resolve=>{resolveSlow=resolve;}));
  const batch=refreshFirmableProfileBatch('run',0);
  await vi.waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(1));
  expect(mocks.progress).toHaveBeenCalledTimes(1);
  expect(mocks.update).not.toHaveBeenCalled();
  resolveSlow({id:'b',name:'Synthetic Director'});await batch;
  expect(mocks.progress).toHaveBeenCalledTimes(3);
});
it('RC-11-generalization: database write errors cannot be reported as saved, and terminal callbacks admit no work',async()=>{
  mocks.save.mockRejectedValueOnce(new Error('database write failure'));
  await expect(refreshFirmableProfileBatch('run',0)).rejects.toThrow('database write failure');
  expect(mocks.update).not.toHaveBeenCalled();
  for(const status of ['failed','complete','partial']) {
    mocks.run.mockResolvedValue({status});
    const before=mocks.enrich.mock.calls.length;
    await expect(refreshFirmableProfileBatch('run',0)).rejects.toThrow('terminal');
    expect(mocks.enrich.mock.calls.length).toBe(before);
  }
});
