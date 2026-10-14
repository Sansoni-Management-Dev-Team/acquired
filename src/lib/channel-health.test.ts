import { afterEach, expect, it, vi } from "vitest";
import * as health from "./channel-health";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it.each(["email", "whatsapp", "linkedin"] as const)("does not advertise %s readiness or contact configured legacy services", async (channel) => {
    vi.stubEnv("LINKEDIN_SERVICE_URL", "https://retired.example.test");
    vi.stubEnv("LINKEDIN_SERVICE_SECRET", "fixture-retired-secret");
    vi.stubEnv("WHATSAPP_SERVICE_URL", "https://retired-wa.example.test");
    vi.stubEnv("WHATSAPP_SERVICE_SECRET", "fixture-retired-secret");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ status: "connected" }));
    const result = await health.checkChannelHealth(channel);
    expect(result).toMatchObject({ status: "unavailable", message: expect.stringContaining("not available yet") });
    expect(Number.isFinite(Date.parse(result.checkedAt))).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/healthy|ready|fixture-retired-secret/);
    expect(fetch).not.toHaveBeenCalled();
});
