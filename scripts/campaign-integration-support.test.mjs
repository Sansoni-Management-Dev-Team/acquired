import { describe, expect, it, vi } from "vitest";
import { assertOwnedTestApp, assertIdleCampaignDatabase, localCampaignDatabase, localCampaignN8n, localCampaignSink, removeCampaignFixtures, localCampaignAppPort, generatedNextFileOnly } from "./campaign-integration-support.mjs";

describe("owned app generated file cleanup", () => {
  it("recognizes Next development/build type paths without erasing other edits", () => {
    const before = 'import "./.next/types/routes.d.ts";\nimport "./.next/types/root-params.d.ts";\n';
    const current = before.replaceAll(".next/types/", ".next-campaign-integration/dev/types/");
    expect(generatedNextFileOnly("next-env.d.ts", before, current)).toBe(true);
    expect(generatedNextFileOnly("next-env.d.ts", before, current + "// unrelated edit\n")).toBe(false);
  });
  it("recognizes only generated tsconfig includes", () => {
    const before = JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] });
    const changed = JSON.parse(before);
    changed.include.push(".next-campaign-integration/types/**/*.ts");
    expect(generatedNextFileOnly("tsconfig.json", before, JSON.stringify(changed))).toBe(true);
    changed.compilerOptions.strict = false;
    expect(generatedNextFileOnly("tsconfig.json", before, JSON.stringify(changed))).toBe(false);
  });
});

const safe = { CAMPAIGN_INTEGRATION_APP: "1", NODE_ENV: "development", LOCAL_DEVELOPMENT: "true", DATABASE_URL: localCampaignDatabase, CAMPAIGN_TEST_SINK_URL: localCampaignSink, APP_URL: `http://localhost:${localCampaignAppPort}`, CAMPAIGN_N8N_URL: localCampaignN8n, CAMPAIGN_APP_URL: `http://host.docker.internal:${localCampaignAppPort}`, CAMPAIGN_REPLY_MONITOR_MODE: "enforce", CAMPAIGN_LINKEDIN_ENABLED: "false", LINKEDIN_SERVICE_URL: "", LINKEDIN_SERVICE_SECRET: "", WHATSAPP_SERVICE_URL: "", WHATSAPP_SERVICE_SECRET: "" };
describe("campaign integration send isolation", () => {
  it("accepts the harness-owned local setup", () => expect(() => assertOwnedTestApp(safe)).not.toThrow());
  it.each(Object.keys(safe))("refuses drift in %s before fixtures or delivery", key => {
    expect(() => assertOwnedTestApp({ ...safe, [key]: "unsafe" })).toThrow();
    const missing = { ...safe }; delete missing[key];
    expect(() => assertOwnedTestApp(missing)).toThrow();
  });
  it("refuses cleanup for a non-fixture organisation", async () => {
    const query = vi.fn();
    await expect(removeCampaignFixtures({ query }, "real-organisation", [])).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
  it("refuses global worker ticks while another subscription is open", async () => {
    await expect(assertIdleCampaignDatabase({ query: vi.fn().mockResolvedValue({ rows: [{ n: 1 }] }) })).rejects.toThrow("idle local campaign database");
    await expect(assertIdleCampaignDatabase({ query: vi.fn().mockResolvedValue({ rows: [{ n: 0 }] }) })).resolves.toBeUndefined();
  });
  it("rolls back cleanup on a failed deletion", async () => {
    const query = vi.fn().mockResolvedValue({}).mockRejectedValueOnce(new Error("begin failed"));
    await expect(removeCampaignFixtures({ query }, "campaign-n8n-e2e-1234abcd", [])).rejects.toThrow("begin failed");
    query.mockReset().mockResolvedValue({}).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("delete failed"));
    await expect(removeCampaignFixtures({ query }, "campaign-n8n-e2e-1234abcd", [])).rejects.toThrow("delete failed");
    expect(query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(query).not.toHaveBeenCalledWith("COMMIT");
  });
});
