import { afterEach, expect, it, vi } from "vitest";
import { criterionDefinitions } from "@/domain/acquisition";
import { generateMandate } from "./mandate-generation";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("uses free-only inference and returns editable, unreviewed criteria", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  const criteria = Object.fromEntries(criterionDefinitions.map(([key]) => [key, "Test preference"]));
  Object.assign(criteria, { subsectors: "CNC machining", geography: "VIC", revenue: "5000000–20000000", revenueCeiling: "20000000", ebitda: "1000000–3000000", headcount: "20–100" });
  const fetcher = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({ name: "Test mandate — engineering", naturalLanguage: "Acquire an engineering business in Victoria.", investmentThesis: "Grow recurring B2B sales.", outreachPositioning: "Explore a confidential conversation.", criteria }) } }] }));
  vi.stubGlobal("fetch", fetcher);
  const brief = await generateMandate();
  expect(brief.criteria).toHaveLength(criterionDefinitions.length);
  expect(brief.criteria.every(c => c.origin === "assumed" && !c.confirmed)).toBe(true);
  expect(brief.disclosureApproved).toBe(false);
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.models.every((model: string) => model.endsWith(":free"))).toBe(true);
  expect(body.provider.max_price).toEqual({ prompt: 0, completion: 0 });
  expect(body.models).toEqual(["dots-studio/dots-3-note-preview:free"]);
  expect(body.reasoning.effort).toBe("none");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("does not fall back to paid AI when free models are unavailable", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "Unavailable" }, { status: 429 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(generateMandate()).rejects.toThrow("429");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.map(([, init]) => JSON.parse(init.body).models)).toEqual([
    ["dots-studio/dots-3-note-preview:free"], ["nex-agi/nex-n2.5-mini:free"],
  ]);
  for (const [, init] of fetcher.mock.calls) expect(JSON.parse(init.body).provider.max_price).toEqual({ prompt: 0, completion: 0 });
});
