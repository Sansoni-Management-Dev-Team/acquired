import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
import { GET } from "./route";
import { mandateCacheScope } from "@/lib/mandate-cache-scope";
const session = { user: { id: "user-a" }, session: { id: "session-a", activeOrganizationId: "org-a", expiresAt: new Date("2026-10-15T12:00:00Z") } };
beforeEach(() => { mocks.session.mockReset(); mocks.session.mockResolvedValue(session); });
it("returns a validated cache identity and absolute expiry without credentials", async () => {
  const request = new Request("http://localhost/api/acquisition-session");
  const response = await GET(request);
  expect(mocks.session).toHaveBeenCalledWith({ headers: request.headers });
  expect(await response.json()).toEqual({ scope: mandateCacheScope(session), expiresAt: session.session.expiresAt.getTime() });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("rejects a signed-out or revoked session", async () => {
  mocks.session.mockResolvedValue(null);
  expect((await GET(new Request("http://localhost/api/acquisition-session"))).status).toBe(401);
});
it("requires an active workspace", async () => {
  mocks.session.mockResolvedValue({ ...session, session: { ...session.session, activeOrganizationId: null } });
  expect((await GET(new Request("http://localhost/api/acquisition-session"))).status).toBe(409);
});
