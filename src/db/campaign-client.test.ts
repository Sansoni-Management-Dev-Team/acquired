import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@vercel/functions", () => ({ attachDatabasePool: vi.fn() }));
vi.mock("pg", () => ({ Pool: class { connect = mock.connect; } }));
import { withCampaignDb, withCampaignWorker, withCampaignTickLock } from "./campaign-client";
import { withCampaignWorkBudget, CampaignWorkDeferred } from "@/lib/campaign-work-budget";
let role: string, bypass: boolean, superuser: boolean, member: boolean;
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DATABASE_URL", "postgresql://test.invalid/test");
  role = "acquire_campaign_user"; bypass = false; superuser = false; member = true;
  mock.connect.mockResolvedValue({ query: mock.query, release: mock.release });
  mock.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT current_user")) return { rows: [{ active_role: role, rolbypassrls: bypass, rolsuper: superuser }] };
    if (sql.startsWith("SELECT 1 FROM member")) return { rowCount: member ? 1 : 0 };
    return { rows: [], rowCount: 1 };
  });
});
afterEach(() => vi.unstubAllEnvs());
it("sets transaction-local owner scope before executing and commits then releases", async () => {
  const callback = vi.fn().mockResolvedValue("result"); expect(await withCampaignDb({ organizationId: "org'; DROP TABLE member; --", userId: "owner" }, callback)).toBe("result");
  expect(mock.query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "SET LOCAL ROLE acquire_campaign_user", expect.stringContaining("SELECT current_user"), "SELECT set_config('app.acquire_org', $1, true), set_config('app.acquire_user', $2, true)", expect.stringContaining("SELECT 1 FROM member"), "COMMIT"]);
  expect(mock.query.mock.calls[3][1]).toEqual(["org'; DROP TABLE member; --", "owner"]); expect(mock.release).toHaveBeenCalledOnce();
});
it.each(["role", "bypass", "superuser", "membership"])("rejects unsafe %s before callback and rolls back", async failure => {
  if (failure === "role") role = "postgres"; if (failure === "bypass") bypass = true; if (failure === "superuser") superuser = true; if (failure === "membership") member = false;
  const callback = vi.fn(); await expect(withCampaignDb({ organizationId: "org", userId: "owner" }, callback)).rejects.toThrow(); expect(callback).not.toHaveBeenCalled(); expect(mock.query).toHaveBeenLastCalledWith("ROLLBACK"); expect(mock.release).toHaveBeenCalledOnce();
});
it.each([false, true])("rolls back callback failure for worker=%s and releases the connection", async worker => {
  role = worker ? "acquire_campaign_worker" : "acquire_campaign_user"; const callback = vi.fn().mockRejectedValue(new Error("failed transaction"));
  await expect(worker ? withCampaignWorker(callback) : withCampaignDb({ organizationId: "org", userId: "owner" }, callback)).rejects.toThrow("failed transaction"); expect(mock.query).toHaveBeenLastCalledWith("ROLLBACK"); expect(mock.release).toHaveBeenCalledOnce();
});
it("worker enters its restricted role, commits and releases", async () => { role = "acquire_campaign_worker"; expect(await withCampaignWorker(async () => 42)).toBe(42); expect(mock.query).toHaveBeenCalledWith("SET LOCAL ROLE acquire_campaign_worker"); expect(mock.query).toHaveBeenLastCalledWith("COMMIT"); expect(mock.release).toHaveBeenCalledOnce(); });

it("does not acquire a database connection after admission has expired", async () => {
  await expect(withCampaignWorkBudget(0, () => withCampaignWorker(async () => 1))).rejects.toBeInstanceOf(CampaignWorkDeferred);
  expect(mock.connect).not.toHaveBeenCalled();
});

it.each([false, true])("scheduler lock acquired=%s always rolls back and releases", async acquired => {
  mock.query.mockResolvedValue({ rows: [{ acquired }] });
  const callback = vi.fn().mockResolvedValue("done");
  expect(await withCampaignTickLock(callback)).toEqual(acquired ? { acquired: true, result: "done" } : { acquired: false });
  expect(callback).toHaveBeenCalledTimes(acquired ? 1 : 0);
  expect(mock.query).toHaveBeenLastCalledWith("ROLLBACK"); expect(mock.release).toHaveBeenCalledOnce();
});

it("releases a scheduler lock when the worker throws", async () => {
  mock.query.mockResolvedValue({ rows: [{ acquired: true }] });
  await expect(withCampaignTickLock(async () => { throw new Error("worker failed"); })).rejects.toThrow("worker failed");
  expect(mock.query).toHaveBeenLastCalledWith("ROLLBACK"); expect(mock.release).toHaveBeenCalledOnce();
});

it("bounds scheduled statements and rolls back database cancellation as deferred work", async () => {
  mock.query.mockImplementation(async (input: string | { text: string }) => {
    const sql = typeof input === "string" ? input : input.text;
    if (sql.startsWith("SELECT current_user")) return { rows: [{ active_role: "acquire_campaign_worker", rolsuper: false, rolbypassrls: false }] };
    if (sql === "SELECT pg_sleep(10)") throw Object.assign(new Error("statement timeout"), { code: "57014" });
    return { rows: [] };
  });
  await expect(withCampaignWorkBudget(2000, () => withCampaignWorker(client => client.query("SELECT pg_sleep(10)")))).rejects.toBeInstanceOf(CampaignWorkDeferred);
  expect(mock.query).toHaveBeenCalledWith("SELECT set_config('statement_timeout', $1, true)", [expect.any(String)]);
  expect(mock.query).toHaveBeenCalledWith(expect.objectContaining({ text: "SELECT pg_sleep(10)", query_timeout: expect.any(Number) }));
  expect(mock.query).toHaveBeenLastCalledWith("ROLLBACK"); expect(mock.release).toHaveBeenCalledOnce();
});
