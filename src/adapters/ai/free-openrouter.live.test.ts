import { expect, it } from "vitest";
import { FreeOpenRouter } from "./free-openrouter";
import { peopleExtractionSchema, peoplePrompt, validatePeopleFindings } from "../../domain/people-research";
import { companyHeadcountPrompt } from "../../domain/company-facts";
import { targetedPrompt, targetedSchema, type TargetedPlan } from "../../domain/targeted-research";
import { type ResearchConfig } from "../../domain/research";

// Explicit opt-in: normal unit tests never use external models or credentials.
it.skipIf(process.env.OPENROUTER_RESEARCH_LIVE !== "1")("extracts sourced facts, preserves unknowns and uses the free waterfall live", async () => {
  const ai = new FreeOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY || "", onUsage: usage => {
    console.info("free-research-live", JSON.stringify(usage));
    expect(usage.cost).toBe(0);
  } });
  const source = "https://example.com/about";
  const config: ResearchConfig = { searchTerms: ["instruments"], seeds: [source], companyName: "Example Instruments", companyDomain: "example.com", purpose: "people", geography: "Australia", approved: true, discover: false, budget: { maxPages: 2, maxDomains: 1, maxMinutes: 10, maxModelCalls: 3 } };
  const text = "Example Instruments employs 18 people. Jordan Example is our General Manager. We have not published Jordan's email address.";
  const people = await ai.complete({ messages: peoplePrompt(text, source, config), max_tokens: 1200, response_format: { type: "json_schema", json_schema: peopleExtractionSchema } });
  const findings = validatePeopleFindings((people.response as { findings: unknown[] }).findings, text, source, config);
  expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Jordan Example", value: "General Manager" })]));
  expect(findings.every(f => !f.email)).toBe(true);
  const negative = await ai.complete({ messages: peoplePrompt("Customer testimonial: Sam Sample, Director of Another Business, recommends us. We publish no staff details.", source, config), max_tokens: 1200, response_format: { type: "json_schema", json_schema: peopleExtractionSchema } });
  expect((negative.response as { findings: unknown[] }).findings).toEqual([]);
  const schema = { type: "object", properties: { value: { type: ["string", "null"] }, quote: { type: ["string", "null"] } }, required: ["value", "quote"], additionalProperties: false };
  const size = await ai.complete({ messages: companyHeadcountPrompt(text, source, config), max_tokens: 300, response_format: { type: "json_schema", json_schema: schema } });
  expect((size.response as { value: string }).value).toContain("18");
  expect(text).toContain((size.response as { quote: string }).quote);
  const unknown = await ai.complete({ messages: companyHeadcountPrompt("We manufacture specialist instruments. No employee count is published.", source, config), max_tokens: 300, response_format: { type: "json_schema", json_schema: schema } });
  expect(unknown.response).toEqual({ value: null, quote: null });
  const plan: TargetedPlan = { companyName: "Example Instruments", companyDomain: "example.com", missing: "A named owner or decision-maker", actions: [{ id: "read_0", kind: "read", url: "https://example.com/team" }, { id: "stop", kind: "stop" }] };
  const planned = await ai.complete({ messages: targetedPrompt(plan), max_tokens: 100, response_format: { type: "json_schema", json_schema: targetedSchema(plan) } });
  expect(planned.response).toEqual({ choice: "read_0" });
}, 240000);
