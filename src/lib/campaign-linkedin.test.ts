import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { campaignLinkedin, linkedinProfileFor } from "./campaign-linkedin";
beforeEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("uses only the authenticated actor's owner scope and validates service results", async () => {
  vi.stubEnv("CAMPAIGN_LINKEDIN_ENABLED", "true"); vi.stubEnv("LINKEDIN_SERVICE_URL", "http://localhost:18096"); vi.stubEnv("LINKEDIN_SERVICE_SECRET", "fixture-secret");
  const fetch = vi.fn().mockResolvedValue(Response.json({ connected: true })); vi.stubGlobal("fetch", fetch);
  expect(await campaignLinkedin({ organizationId: "org", userId: "owner" }, { operation: "status", profile: "https://linkedin.com/in/alex" })).toEqual({ connected: true });
  expect(String(fetch.mock.calls[0][0])).toBe("http://localhost:18096/campaign?organizationId=org&userId=owner");
  expect(fetch.mock.calls[0][1].cache).toBe("no-store");
});
it("does not contact the provider with the campaign feature disabled", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); vi.stubEnv("CAMPAIGN_LINKEDIN_ENABLED", "false");
  await expect(campaignLinkedin({ organizationId: "org", userId: "owner" }, { operation: "connect", profile: "https://linkedin.com/in/alex" })).rejects.toThrow("not enabled");
  expect(fetch).not.toHaveBeenCalled();
});
it("accepts enriched profile URLs and rejects lookalike hosts or company pages", () => {
  expect(linkedinProfileFor({ linkedinUrl: "https://au.linkedin.com/in/alex" })).toBe("https://au.linkedin.com/in/alex");
  expect(() => linkedinProfileFor({ linkedinUrl: "https://linkedin.com.evil.test/in/alex" })).toThrow();
  expect(() => linkedinProfileFor({ linkedinUrl: "https://linkedin.com/company/alex" })).toThrow();
});
