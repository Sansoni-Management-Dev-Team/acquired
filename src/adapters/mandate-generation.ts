import { z } from "zod";
import { briefSchema, criterionDefinitions, emptyBrief } from "@/domain/acquisition";
import { FreeOpenRouter, FREE_MANDATE_MODELS } from "./ai/free-openrouter";

const generatedSchema = z.object({
  name: z.string().min(1).max(100),
  naturalLanguage: z.string().min(1).max(10000),
  investmentThesis: z.string().min(1).max(1500),
  outreachPositioning: z.string().min(1).max(1500),
  criteria: z.object(Object.fromEntries(criterionDefinitions.map(([key]) => [key, z.string().min(1).max(1500)]))),
});

export async function generateMandate() {
  const ai = new FreeOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY || "",
    models: FREE_MANDATE_MODELS,
    paidFallback: false,
    sequentialFreeFallback: true,
  });
  const result = await ai.complete({
    operation: "mandate_generation",
    messages: [
      { role: "system", content: `Create a fresh, fictional acquisition mandate for testing an Australian business acquisition app. Choose a specific small or medium business sector and a coherent investment strategy. Vary sector, geography and financial ranges each time. Do not name real targets or claim actual buyer credentials. Use Australian English and AUD. Return the requested JSON with a name beginning "Test mandate", a readable acquisition brief, investment thesis, exploratory outreach positioning and every criterion. The prose and criteria must agree. Separate alternative subsectors with semicolons. Geography must use National or comma-separated Australian state codes. Revenue, revenueCeiling, ebitda and headcount must use numeric values or ranges (e.g. 5000000–20000000); ensure ascending ranges, revenueCeiling >= revenue maximum and EBITDA below revenue. Criteria: ${criterionDefinitions.map(([key, label]) => `${key}: ${label}`).join("; ")}.` },
      { role: "user", content: `Generate a new acquisition brief. Variation seed: ${crypto.randomUUID()}` },
    ],
    max_tokens: 4000,
    temperature: 0.9,
    reasoning_effort: "none",
    response_format: { type: "json_schema", json_schema: z.toJSONSchema(generatedSchema) },
  });
  const generated = generatedSchema.parse(result.response);
  const initial = emptyBrief();
  return briefSchema.parse({
    ...initial,
    ...generated,
    criteria: initial.criteria.map(c => ({ ...c, value: generated.criteria[c.key], state: "specified", origin: "assumed", confirmed: false })),
  });
}
