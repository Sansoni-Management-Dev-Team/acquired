import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
import { GET, POST, DELETE } from "./route";
beforeEach(() => {
  vi.restoreAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "owner" }, session: { activeOrganizationId: "org" } });
  process.env.WHATSAPP_SERVICE_URL = "http://localhost:18095";
  process.env.WHATSAPP_SERVICE_SECRET = "private-service-secret";
});
describe("WhatsApp channel proxy", () => {
  it("requires a logged-in owner and rejects foreign origins", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://localhost/api/channels/whatsapp"))).status).toBe(401);
    expect((await POST(new Request("http://localhost/api/channels/whatsapp", { method: "POST", headers: { origin: "https://another.example" } }))).status).toBe(403);
  });
  it("derives ownership from the session and strips secrets from responses", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ status: "connected", address: "61400000000", encrypted_creds: "sensitive", keys: "sensitive" }));
    const response = await GET(new Request("http://localhost/api/channels/whatsapp?userId=attacker"));
    const [url, options] = fetch.mock.calls[0];
    expect(String(url)).toContain("userId=owner"); expect(String(url)).toContain("organizationId=org");
    expect(options?.headers).toEqual({ Authorization: "Bearer private-service-secret" });
    expect(await response.json()).toEqual({ status: "connected", address: "61400000000" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("disconnect uses authenticated DELETE and missing config is unavailable", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ status: "disconnected" }));
    expect((await DELETE(new Request("http://localhost/api/channels/whatsapp", { method: "DELETE", headers: { origin: "http://localhost" } }))).status).toBe(200);
    expect(fetch.mock.calls[0][1]?.method).toBe("DELETE");
    delete process.env.WHATSAPP_SERVICE_URL;
    expect((await GET(new Request("http://localhost/api/channels/whatsapp"))).status).toBe(503);
  });
});
