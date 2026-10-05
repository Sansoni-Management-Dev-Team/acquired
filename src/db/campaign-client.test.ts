import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@vercel/functions", () => ({ attachDatabasePool: vi.fn() }));
vi.mock("pg", () => ({ Pool: class { connect = mock.connect; } }));
import { withCampaignDb, withCampaignWorker } from "./campaign-client";
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
