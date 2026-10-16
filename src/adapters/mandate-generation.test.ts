import { afterEach, expect, it, vi } from "vitest";
import { criterionDefinitions } from "@/domain/acquisition";
import { FREE_RESEARCH_MODELS, MERCURY_FALLBACK_MODEL, NEMO_FALLBACK_MODEL } from "./ai/free-openrouter";
import { generateMandate } from "./mandate-generation";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("uses free-first inference and returns editable, unreviewed criteria", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  const criteria = Object.fromEntries(criterionDefinitions.map(([key]) => [key, "Test preference"]));
  Object.assign(criteria, { subsectors: "CNC machining", geography: "VIC", revenue: "5000000–20000000", revenueCeiling: "20000000", ebitda: "1000000–3000000", headcount: "20–100" });
  const fetcher = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({ name: "Test mandate — engineering", naturalLanguage: "Acquire an engineering business in Victoria.", investmentThesis: "Grow recurring B2B sales.", outreachPositioning: "Explore a confidential conversation.", criteria: Object.fromEntries(Object.entries(criteria).map(([key, value]) => [key, { value, importance: "preference", quote: "" }])) }) } }] }));
  vi.stubGlobal("fetch", fetcher);
  const brief = await generateMandate();
  expect(brief.criteria).toHaveLength(criterionDefinitions.length);
  expect(brief.criteria.every(c => c.origin === "assumed" && !c.confirmed)).toBe(true);
  expect(brief.disclosureApproved).toBe(false);
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.models.every((model: string) => model.endsWith(":free"))).toBe(true);
  expect(body.provider.max_price).toEqual({ prompt: 0, completion: 0 });
  expect(body.models).toEqual(FREE_RESEARCH_MODELS);
  expect(body.reasoning.effort).toBe("none");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("exhausts the bounded OpenRouter waterfall when no OpenAI key is set", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  vi.stubEnv("OPENAI_API_KEY", "");
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "Unavailable" }, { status: 429 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(generateMandate()).rejects.toThrow("429");
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls.map(([, init]) => JSON.parse(init.body).models)).toEqual([
    FREE_RESEARCH_MODELS, [MERCURY_FALLBACK_MODEL], [NEMO_FALLBACK_MODEL],
  ]);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).provider.max_price).toEqual({ prompt: 0, completion: 0 });
});

it("falls back to a cheap OpenAI model after every free model fails", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  vi.stubEnv("OPENAI_API_KEY", "openai-test-key");
  const criteria = Object.fromEntries(criterionDefinitions.map(([key]) => [key, "Test preference"]));
  Object.assign(criteria, { subsectors: "CNC machining", geography: "VIC", revenue: "5000000–20000000", revenueCeiling: "20000000", ebitda: "1000000–3000000", headcount: "20–100" });
  const generated = { name: "Test mandate — engineering", naturalLanguage: "Acquire an engineering business in Victoria.", investmentThesis: "Grow recurring B2B sales.", outreachPositioning: "Explore a confidential conversation.", criteria: Object.fromEntries(Object.entries(criteria).map(([key, value]) => [key, { value, importance: "preference", quote: "" }])) };
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ error: "Unavailable" }, { status: 429 }))
    .mockResolvedValueOnce(Response.json({ error: "Unavailable" }, { status: 429 }))
    .mockResolvedValueOnce(Response.json({ error: "Unavailable" }, { status: 429 }))
    .mockResolvedValueOnce(Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(generated) } }] }));
  vi.stubGlobal("fetch", fetcher);
  const brief = await generateMandate();
  expect(brief.name).toBe("Test mandate — engineering");
  expect(fetcher).toHaveBeenCalledTimes(4);
  const [url, init] = fetcher.mock.calls[3];
  expect(url).toBe("https://api.openai.com/v1/chat/completions");
  expect(init.headers.Authorization).toBe("Bearer openai-test-key");
  const body = JSON.parse(init.body);
  expect(body.model).toBe("gpt-6-luna");
  expect(body.response_format.type).toBe("json_schema");
});

it("uses free models first even for a buyer description and keeps unsupplied criteria unknown", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  vi.stubEnv("OPENAI_API_KEY", "openai-test-key");
  const criteria = Object.fromEntries(criterionDefinitions.map(([key]) => [key, "Unknown"]));
  Object.assign(criteria, { subsectors: "Gym equipment suppliers", geography: "Unknown" });
  const generated = { name: "Australian Gym Supply Acquisition", naturalLanguage: "AI-expanded text", investmentThesis: "Explore gym supply businesses.", outreachPositioning: "Discuss a possible acquisition.", criteria: Object.fromEntries(Object.entries(criteria).map(([key, value]) => [key, { value, importance: "preference", quote: key === "subsectors" ? "gym supply businesses" : "" }])) };
  const fetcher = vi.fn().mockResolvedValue(Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(generated) } }] }));
  vi.stubGlobal("fetch", fetcher);
  const brief = await generateMandate("Find me gym supply businesses");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
  expect(JSON.parse(fetcher.mock.calls[0][1].body).models).toEqual(FREE_RESEARCH_MODELS);
  expect(brief.naturalLanguage).toBe("Find me gym supply businesses");
  expect(brief.criteria.find(item => item.key === "subsectors")?.value).toBe("Gym equipment suppliers");
  expect(brief.criteria.find(item => item.key === "subsectors")?.origin).toBe("supplied");
  expect(brief.criteria.find(item => item.key === "subsectors")?.confirmed).toBe(false);
  expect(brief.criteria.find(item => item.key === "revenue")?.state).toBe("unknown");
  expect(brief.criteria.find(item => item.key === "geography")?.state).toBe("unrestricted");
});


it("preserves extracted requirements and rejects ungrounded conditions", async () => {
  vi.stubEnv("OPENAI_API_KEY", "openai-test-key");
  const criteria = Object.fromEntries(criterionDefinitions.map(([key]) => [key, { value: "Unknown", importance: "preference", quote: "" }]));
  Object.assign(criteria, {
    headcount: { value: "20–60", importance: "requirement", quote: "must have 20 to 60 employees" },
    multiple: { value: "6–9x EBITDA", importance: "preference", quote: "6–9x EBITDA" },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ name: "Acquisition", naturalLanguage: "Draft", investmentThesis: "Acquire a business.", outreachPositioning: "Explore acquisition.", criteria }) } }] })));
  const brief = await generateMandate("The business must have 20 to 60 employees.");
  expect(brief.criteria.find(c => c.key === "headcount")).toMatchObject({ importance: "requirement", origin: "supplied", confirmed: false, state: "specified" });
  expect(brief.criteria.find(c => c.key === "multiple")).toMatchObject({ state: "unknown", value: "", confirmed: false });
});
