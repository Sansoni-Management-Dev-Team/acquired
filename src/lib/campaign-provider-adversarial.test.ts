import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { campaignLinkedin } from "./campaign-linkedin";
import { campaignWhatsapp } from "./campaign-whatsapp";
import { readChannelReplies } from "./campaign-reply-providers";
const actor = { organizationId: "org&userId=victim", userId: "owner?organizationId=victim" }; const fetchMock = vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); vi.stubEnv("CAMPAIGN_LINKEDIN_ENABLED", "true"); for (const prefix of ["LINKEDIN", "WHATSAPP"]) { vi.stubEnv(`${prefix}_SERVICE_URL`, "https://provider.test"); vi.stubEnv(`${prefix}_SERVICE_SECRET`, "fixture-secret"); } });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const send = (channel: "linkedin" | "whatsapp") => channel === "linkedin" ? campaignLinkedin(actor, { operation: "message", profile: "https://linkedin.com/in/alex", key: "campaign:enrolment:step", text: "Hi" }) : campaignWhatsapp(actor, { key:"campaign:enrol:step", recipient: "61412345678@s.whatsapp.net", text: "Hi" });
for (const channel of ["linkedin", "whatsapp"] as const) {
  it(`${channel}: preserves owner boundaries when IDs contain query delimiters`, async () => {
    fetchMock.mockResolvedValue(Response.json(channel === "linkedin" ? { action: { id: "id", status: "submitted" } } : { contractVersion:1,sentAt:new Date().toISOString(),id: "id", recipient: "61412345678@s.whatsapp.net", status: "submitted" })); await send(channel);
    const url = new URL(String(fetchMock.mock.calls[0][0])); expect(url.searchParams.getAll("organizationId")).toEqual([actor.organizationId]); expect(url.searchParams.getAll("userId")).toEqual([actor.userId]);
  });
  it.each([401, 403, 429, 500, 503])(`${channel}: never retries provider HTTP %s`, async status => { fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "blocked", detail: "blocked" }), { status })); await expect(send(channel)).rejects.toThrow(); expect(fetchMock).toHaveBeenCalledOnce(); });
  it.each(["timeout", "invalid-json", "null", "bad-schema"])(`${channel}: rejects ambiguous response %s without retrying`, async mode => {
    if (mode === "timeout") fetchMock.mockRejectedValue(new Error("timeout"));
    else fetchMock.mockResolvedValue(mode === "invalid-json" ? new Response("<html>error</html>") : Response.json(mode === "null" ? null : { action: { id: 4, status: "success" }, id: 4, status: "success" }));
    await expect(send(channel)).rejects.toThrow(); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it(`${channel}: reply reads reject redirects and preserve opaque cursors`, async () => {
    fetchMock.mockResolvedValue(Response.json({ accountIdentity: "account", events: [], complete: true, checkedAt: new Date().toISOString(), nextCursor: null }));
    const cursor = "a&userId=other/+?"; await readChannelReplies(actor, channel, cursor);
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("cursor")).toBe(cursor); expect(fetchMock.mock.calls[0][1].redirect).toBe("error");
  });
}
it.each(["linkedin", "whatsapp"] as const)("%s sends cannot follow a redirect to another endpoint", async channel => {
  fetchMock.mockResolvedValue(Response.json(channel === "linkedin" ? { action: { id: "id", status: "submitted" } } : { contractVersion:1,sentAt:new Date().toISOString(),id: "id", recipient: "61412345678@s.whatsapp.net", status: "submitted" })); await send(channel); expect(fetchMock.mock.calls[0][1].redirect).toBe("error");
});
it.each([{ action: { id: "", status: "submitted" } }, { action: { id: "id", status: "submitted", attemptedAt: -1 } }, { status: "retry", nextEligibleAt: -1 }])("LinkedIn rejects invalid durable action data %#", async result => { fetchMock.mockResolvedValue(Response.json(result)); await expect(send("linkedin")).rejects.toThrow(); expect(fetchMock).toHaveBeenCalledOnce(); });
