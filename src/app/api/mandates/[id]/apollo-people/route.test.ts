import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), members: vi.fn(), find: vi.fn(), values: vi.fn(), upsert: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: m.session } } }));
vi.mock("@/adapters/apollo-people", () => ({ findApolloPeople: m.find }));
vi.mock("@/db/client", () => ({ requireDb: () => ({ select: () => ({ from: () => ({ innerJoin: () => ({ where: m.members }) }) }), transaction: async (fn: (tx: unknown) => unknown) => fn({ insert: () => ({ values: m.values }) }) }) }));
import { POST } from "./route";
import { clearTargetSearchGuardForTests } from "@/adapters/target-search-guard";
const id = "00000000-0000-4000-8000-000000000001", targetId = "00000000-0000-4000-8000-000000000002";
const request = () => new Request("http://localhost", { method: "POST", body: JSON.stringify({targetId, domain:"injected.example"}) });
const ctx = {params:Promise.resolve({id})};
beforeEach(() => {
 vi.resetAllMocks(); clearTargetSearchGuardForTests(); vi.stubEnv("APOLLO_API_KEY","test");
 m.session.mockResolvedValue({session:{activeOrganizationId:"org"},user:{id:"user"}});
 m.members.mockResolvedValue([{target:{id:targetId,domain:"example.com",companyName:"Example"}}]);
 m.values.mockReturnValue({onConflictDoUpdate:m.upsert}); m.upsert.mockResolvedValue(undefined);
 m.find.mockResolvedValue({people:[{id:"apollo1",name:"Alex Example",role:"Owner",sourceUrl:"https://app.apollo.io/#/people/apollo1"}],failed:0,searched:1});
});
afterEach(() => vi.unstubAllEnvs());
it("rejects unauthenticated and nonmember requests before provider access", async () => {
 m.session.mockResolvedValueOnce(null); expect((await POST(request(),ctx)).status).toBe(401);
 m.members.mockResolvedValueOnce([]); expect((await POST(request(),ctx)).status).toBe(404);
 expect(m.find).not.toHaveBeenCalled();
});
it("requires server configuration and a saved website", async () => {
 vi.stubEnv("APOLLO_API_KEY",""); expect((await POST(request(),ctx)).status).toBe(503);
 vi.stubEnv("APOLLO_API_KEY","test"); m.members.mockResolvedValueOnce([{target:{id:targetId,domain:null}}]);
 expect((await POST(request(),ctx)).status).toBe(400); expect(m.find).not.toHaveBeenCalled();
});
it("uses persisted company identity and idempotently saves unverified provider leads", async () => {
 expect((await POST(request(),ctx)).status).toBe(200);
 expect(m.find).toHaveBeenCalledWith("example.com");
 const firstJob = m.values.mock.calls[0][0].id;
 expect(m.values.mock.calls[1][0]).toMatchObject({organizationId:"org",targetId,evidenceKey:"apollo:apollo1",evidence:{source:"Apollo",status:"unverified",saleAuthority:"unconfirmed"}});
 await POST(request(),ctx); expect(m.values.mock.calls[2][0].id).toBe(firstJob);
});
it("releases the search slot after provider failure so retry works", async () => {
 m.find.mockRejectedValueOnce(new Error("Apollo lookup failed (429)."));
 expect((await POST(request(),ctx)).status).toBe(502);
 expect((await POST(request(),ctx)).status).toBe(200);
});
