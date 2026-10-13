import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), authorize: vi.fn(), verify: vi.fn(), exchange: vi.fn(), profile: vi.fn(), database: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: m.session } } }));
vi.mock("@/lib/google-oauth", () => ({ createGoogleAuthorization: m.authorize, verifyGoogleState: m.verify, exchangeGoogleCode: m.exchange, fetchGoogleUserInfo: m.profile }));
vi.mock("@/db/client", () => ({ requireDb: m.database }));
vi.mock("@/lib/gmail-connection", () => ({ connectionCanMonitorReplies: vi.fn() }));
import { GET as connect } from "./connect/route";
import { GET as callback } from "./callback/route";
beforeEach(() => { vi.resetAllMocks(); m.session.mockResolvedValue({ user: { id: "owner", email: "owner@example.test" }, session: { activeOrganizationId: "org" } }); m.authorize.mockReturnValue({ url: "https://accounts.google.com/synthetic" }); m.verify.mockReturnValue({ userId: "owner", organizationId: "org", verifier: "fixture" }); m.exchange.mockResolvedValue({ refresh_token: "fixture", access_token: "fixture", scope: "", expires_in: 3600 }); vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({})); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it.each([["connect", connect], ["callback", callback]] as const)("retires Gmail %s even with configured Google credentials and valid-looking callback", async (path, route) => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "fixture-google-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "fixture-google-secret");
    const response = await route(new Request(`https://app.example/api/mailbox/google/${path}?code=fixture&state=fixture`));
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "connection_method_retired" });
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    for (const operation of [m.authorize, m.verify, m.exchange, m.profile, m.database, globalThis.fetch])
        expect(operation).not.toHaveBeenCalled();
});
it("requires authenticated scope before retired callbacks and never exchanges OAuth codes", async () => {
    m.session.mockResolvedValueOnce(null);
    expect((await callback(new Request("https://app.example/api/mailbox/google/callback?code=fixture&state=fixture"))).status).toBe(401);
    m.session.mockResolvedValueOnce({ user: { id: "owner" }, session: {} });
    expect((await callback(new Request("https://app.example/api/mailbox/google/callback"))).status).toBe(403);
    expect(m.verify).not.toHaveBeenCalled();
    expect(m.exchange).not.toHaveBeenCalled();
    expect(m.database).not.toHaveBeenCalled();
});
