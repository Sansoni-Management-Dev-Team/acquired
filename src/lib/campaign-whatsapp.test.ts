import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assertCampaignWhatsappConnected, campaignWhatsapp, whatsappRecipientFor } from "./campaign-whatsapp";
const actor = { organizationId: "org", userId: "owner" };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function setup(data: unknown) {
  vi.stubEnv("WHATSAPP_SERVICE_URL", "http://127.0.0.1:18095");
  vi.stubEnv("WHATSAPP_SERVICE_SECRET", "fixture-secret");
  const fetch = vi.fn().mockResolvedValue(Response.json(data)); vi.stubGlobal("fetch", fetch); return fetch;
}
it("normalizes an international phone and rejects ambiguous or masked numbers", () => {
  expect(whatsappRecipientFor({ phone: "+61 (412) 345-678" })).toBe("61412345678@s.whatsapp.net");
  for (const phone of ["0412345678", "+61 4xx xxx xxx", "+123", "+61412345678 ext 9", "61412345678@s.whatsapp.net", ""]) expect(() => whatsappRecipientFor({ phone })).toThrow("country code");
});
it("sends through the authenticated owner's service scope", async () => {
  const fetch = setup({ id: "provider-id", recipient: "61412345678@s.whatsapp.net", status: "submitted" });
  const message = { recipient: "61412345678@s.whatsapp.net", text: "Hi Alex" };
  expect(await campaignWhatsapp(actor, message)).toMatchObject({ id: "provider-id" });
  expect(String(fetch.mock.calls[0][0])).toBe("http://127.0.0.1:18095/message?organizationId=org&userId=owner");
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: "POST", cache: "no-store", headers: { Authorization: "Bearer fixture-secret" }, body: JSON.stringify(message) });
});
it("requires a connected account and checks it without sending", async () => {
  const fetch = setup({ status: "disconnected" });
  await expect(assertCampaignWhatsappConnected(actor)).rejects.toThrow("Connect your WhatsApp");
  expect(fetch).toHaveBeenCalledOnce();
  expect(String(fetch.mock.calls[0][0])).toContain("/connection?");
  expect(fetch.mock.calls[0][1].method).toBe("GET");
});
it("does not call the service when unconfigured or when personalized text exceeds its limit", async () => {
  const fetch = setup({}); vi.stubEnv("WHATSAPP_SERVICE_URL", "");
  await expect(campaignWhatsapp(actor, { recipient: "61412345678@s.whatsapp.net", text: "Hi" })).rejects.toThrow("not configured");
  await expect(campaignWhatsapp(actor, { recipient: "61412345678@s.whatsapp.net", text: "x".repeat(4001) })).rejects.toThrow("Invalid");
  expect(fetch).not.toHaveBeenCalled();
});
it("never retries an ambiguous network response or accepts missing provider IDs", async () => {
  const fetch = setup({ status: "submitted" });
  await expect(campaignWhatsapp(actor, { recipient: "61412345678@s.whatsapp.net", text: "Hi" })).rejects.toThrow();
  fetch.mockRejectedValue(new Error("timeout"));
  await expect(campaignWhatsapp(actor, { recipient: "61412345678@s.whatsapp.net", text: "Hi" })).rejects.toThrow("timeout");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("keeps temporary WhatsApp account lookup failures retryable", async () => {
  vi.stubEnv("WHATSAPP_SERVICE_URL", "http://localhost:18095"); vi.stubEnv("WHATSAPP_SERVICE_SECRET", "fixture-secret");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 503 })));
  const { assertCampaignWhatsappConnected } = await import("./campaign-whatsapp");
  await expect(assertCampaignWhatsappConnected({ organizationId: "org", userId: "owner" })).rejects.toMatchObject({ code: "unavailable" });
});
