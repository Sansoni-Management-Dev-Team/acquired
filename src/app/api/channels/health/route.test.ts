import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), database: vi.fn(), decrypt: vi.fn(), oldHosted: vi.fn(), oldGmail: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: m.session } } }));
vi.mock("@/db/client", () => ({ requireDb: m.database }));
vi.mock("@/lib/token-crypto", () => ({ decryptToken: m.decrypt }));
import { POST } from "./route";
const req = (query: string, origin = "https://app.example") => new Request(`https://app.example/api/channels/health?${query}`, { method: "POST", headers: { origin } });
beforeEach(() => { vi.resetAllMocks(); m.session.mockResolvedValue({ user: { id: "owner" }, session: { activeOrganizationId: "org" } }); vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true, status: "connected" })); vi.stubEnv("LINKEDIN_SERVICE_URL", "https://retired.example.test"); vi.stubEnv("LINKEDIN_SERVICE_SECRET", "fixture-retired-secret"); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it.each(["gmail", "whatsapp", "linkedin"])("retires old %s health checks without loading tokens or services", async (provider) => {
    const response = await POST(req(`provider=${provider}`));
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "connection_method_retired" });
    expect(m.database).not.toHaveBeenCalled();
    expect(m.decrypt).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
});
it.each(["email", "whatsapp", "linkedin"])("returns truthful unavailable Unipile %s health", async (channel) => {
    const response = await POST(req(`channel=${channel}&backend=unipile`));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "unavailable" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(m.database).not.toHaveBeenCalled();
});
it("retains session, organization and trusted origin guards", async () => {
    m.session.mockResolvedValueOnce(null);
    expect((await POST(req("channel=email&backend=unipile"))).status).toBe(401);
    m.session.mockResolvedValueOnce({ user: { id: "owner" }, session: {} });
    expect((await POST(req("channel=email&backend=unipile"))).status).toBe(403);
    expect((await POST(req("channel=email&backend=unipile", "https://other.example"))).status).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
});
it.each(["channel=unknown&backend=unipile", "channel=email&backend=direct", "provider=unknown", "channel=email", ""])("rejects unsupported health selection %s", async (query) => {
    expect((await POST(req(query))).status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
});
