import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
import { GET, POST, DELETE } from "./route";
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
beforeEach(() => {
    mocks.getSession.mockResolvedValue({ user: { id: "owner" }, session: { activeOrganizationId: "org" } });
    vi.stubEnv("WHATSAPP_SERVICE_URL", "https://legacy.example.test");
    vi.stubEnv("WHATSAPP_SERVICE_SECRET", "fixture-retired-secret");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ status: "connected" }));
});
it.each([["GET", GET], ["POST", POST], ["DELETE", DELETE]] as const)("retires authenticated WhatsApp %s without service egress or content processing", async (method, handler) => {
    const req = new Request("https://app.example/api/channels/whatsapp?op=connection&userId=attacker", { method, headers: { origin: "https://app.example" }, ...(method === "POST" ? { body: '{"private":"retired-body"}' } : {}) });
    const body = vi.spyOn(req, "text");
    const response = await handler(req);
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "connection_method_retired" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(body).not.toHaveBeenCalled();
});
it("keeps authentication, organization selection and write origin guards", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://app.example/api/channels/whatsapp"))).status).toBe(401);
    mocks.getSession.mockResolvedValueOnce({ user: { id: "owner" }, session: {} });
    expect((await GET(new Request("https://app.example/api/channels/whatsapp"))).status).toBe(403);
    for (const handler of [POST, DELETE])
        expect((await handler(new Request("https://app.example/api/channels/whatsapp", { method: handler === POST ? "POST" : "DELETE", headers: { origin: "https://other.example" } }))).status).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
});
it("accepts the trusted public write origin behind an internal proxy and still retires", async () => {
    vi.stubEnv("APP_URL", "https://app.example");
    const response = await POST(new Request("http://0.0.0.0:3000/api/channels/whatsapp", { method: "POST", headers: { origin: "https://app.example" }, body: "{}" }));
    expect(response.status).toBe(410);
    expect(globalThis.fetch).not.toHaveBeenCalled();
});
