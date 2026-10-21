import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@vercel/functions", () => ({ attachDatabasePool: vi.fn() }));
vi.mock("pg", () => ({ Pool: class { connect = mock.connect; } }));
import { withCampaignDb, withCampaignWorker, withCampaignTickLock } from "./campaign-client";
import { withCampaignWorkBudget, CampaignWorkDeferred } from "@/lib/campaign-work-budget";
it.each(['true','false'])('holds installed send authority before membership and policy callbacks when runtime=%s', async(enabled)=>{
 vi.stubEnv('COMMUNICATIONS_RUNTIME_ENABLED',enabled);let locked=false;
 mock.query.mockImplementation(async(sql:string)=>{
  if(sql.startsWith('SELECT current_user'))return {rows:[{active_role:role,rolbypassrls:false,rolsuper:false}]};
  if(sql.includes('to_regprocedure'))return {rows:[{installed:true}]};
  if(sql.startsWith('SELECT public.communications_lock_send_gate')){locked=true;return {rows:[{revision:'1'}]};}
  if(sql.startsWith('SELECT 1 FROM member')){expect(locked).toBe(true);return {rowCount:1};}return {rows:[]};
 });
 await withCampaignDb({organizationId:'org',userId:'owner'},async()=>expect(locked).toBe(true));
 locked=false;role='acquire_campaign_worker';await withCampaignWorker(async()=>expect(locked).toBe(true),'org');
});
it('refuses policy callbacks if the configured runtime schema is absent',async()=>{
 vi.stubEnv('COMMUNICATIONS_RUNTIME_ENABLED','true');mock.query.mockImplementation(async(sql:string)=>sql.startsWith('SELECT current_user')?{rows:[{active_role:role,rolbypassrls:false,rolsuper:false}]}:sql.includes('to_regprocedure')?{rows:[{installed:false}]}:{rows:[],rowCount:1});
 const callback=vi.fn();await expect(withCampaignDb({organizationId:'org',userId:'owner'},callback)).rejects.toThrow();expect(callback).not.toHaveBeenCalled();
});
let role: string, bypass: boolean, superuser: boolean, member: boolean;
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DATABASE_URL", "postgresql://test.invalid/test");
  role = "acquire_campaign_user"; bypass = false; superuser = false; member = true;
  mock.connect.mockResolvedValue({ query: mock.query, release: mock.release });
  mock.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT current_user")) return { rows: [{ active_role: role, rolbypassrls: bypass, rolsuper: superuser }] };
    if(sql.includes("to_regprocedure"))return {rows:[{installed:false}]};
    if (sql.startsWith("SELECT 1 FROM member")) return { rowCount: member ? 1 : 0 };
    return { rows: [], rowCount: 1 };
  });
});
afterEach(() => vi.unstubAllEnvs());
it("sets transaction-local owner scope before executing and commits then releases", async () => {
  const callback = vi.fn().mockResolvedValue("result"); expect(await withCampaignDb({ organizationId: "org'; DROP TABLE member; --", userId: "owner" }, callback)).toBe("result");
  expect(mock.query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "SET LOCAL ROLE acquire_campaign_user", expect.stringContaining("SELECT current_user"), "SELECT set_config('app.acquire_org', $1, true), set_config('app.acquire_user', $2, true)", expect.stringContaining("to_regprocedure"), expect.stringContaining("SELECT 1 FROM member"), "COMMIT"]);
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
it('propagates only trusted validated registered runtime context before the held source callback',async()=>{const {localContextEnv}=await import('../lib/agent-runtime-context.test-fixture');for(const[k,v]of Object.entries(localContextEnv))vi.stubEnv(k,v);await withCampaignDb({organizationId:'org',userId:'owner'},async()=>{expect(mock.query).toHaveBeenCalledWith("SELECT set_config('app.acquire_runtime_id',$1,true),set_config('app.acquire_channel_simulation',$2,true)",['agent-multichannel-20261017','true']);});});

it.each([true,false])('uses an explicit scoped driver and retains real membership refusal (member=%s)',async allowed=>{
 member=allowed;const connect=vi.fn(async()=>({query:mock.query,release:mock.release})),callback=vi.fn(async()=>42);
 const result=withCampaignDb({organizationId:'org',userId:'owner'},callback,{pool:{connect} as never});
 if(allowed)expect(await result).toBe(42);else await expect(result).rejects.toThrow('Campaign owner is no longer');
 expect(connect).toHaveBeenCalledOnce();expect(mock.connect).not.toHaveBeenCalled();expect(mock.query).toHaveBeenCalledWith('SET LOCAL ROLE acquire_campaign_user');expect(callback).toHaveBeenCalledTimes(allowed?1:0);
});
