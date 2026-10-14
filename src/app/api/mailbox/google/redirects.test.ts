import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), verifyState: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/db/client", () => ({ requireDb: vi.fn() }));
vi.mock("@/test/fixtures/gmail-connection", () => ({ connectionCanMonitorReplies: vi.fn() }));
vi.mock("@/lib/google-oauth", () => ({ createGoogleAuthorization: vi.fn(), verifyGoogleState: mocks.verifyState, exchangeGoogleCode: vi.fn(), fetchGoogleUserInfo: vi.fn() }));
import { GET as connect } from "./connect/route";
import { GET as callback } from "./callback/route";
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
it("redirects unauthenticated Gmail connections to the public sign-in page", async () => {
    vi.stubEnv("APP_URL", "https://acquire.mlai.au");
    mocks.getSession.mockResolvedValue(null);
    const response = await connect(new Request("http://0.0.0.0:3000/api/mailbox/google/connect"));
    expect(response.headers.get("location")).toBe("https://acquire.mlai.au/sign-in?next=/settings");
});
it("requires sign-in for retired Gmail callbacks and never echoes OAuth errors", async () => {
    vi.stubEnv("APP_URL", "https://acquire.mlai.au");
    mocks.getSession.mockResolvedValue({ user: { id: "owner" }, session: { activeOrganizationId: "org" } });
    const response = await callback(new Request("http://0.0.0.0:3000/api/mailbox/google/callback?code=invalid&state=invalid"));
    expect(response.status).toBe(410);
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.verifyState).not.toHaveBeenCalled();
});
