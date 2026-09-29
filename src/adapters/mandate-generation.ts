import { z } from "zod";
import { briefSchema, criterionDefinitions, emptyBrief } from "@/domain/acquisition";
import { FreeOpenRouter, FREE_MANDATE_MODELS } from "./ai/free-openrouter";
import { completeOpenAiJson, OPENAI_FALLBACK_MODEL } from "./ai/openai";

const generatedSchema = z.object({
  name: z.string().min(1).max(100),
  naturalLanguage: z.string().min(1).max(10000),
  investmentThesis: z.string().min(1).max(1500),
  outreachPositioning: z.string().min(1).max(1500),
  criteria: z.object(Object.fromEntries(criterionDefinitions.map(([key]) => [key, z.string().min(1).max(1500)]))),
});

export async function generateMandate(description?: string) {
  const ai = new FreeOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY || "",
    models: FREE_MANDATE_MODELS,
    paidFallback: false,
    sequentialFreeFallback: true,
  });
  const messages = [
    { role: "system", content: `${description ? "Create an Australian acquisition mandate from the user's description. Generate a concise, descriptive mandate name and a coherent first-draft brief. Do not invent buyer credentials, named target companies, financial ranges, or other preferences the user did not provide. Return Unknown for each criterion not supplied or clearly implied by the description. If geography is absent, use National so Australian company search can begin." : "Create a fresh, fictional acquisition mandate for testing an Australian business acquisition app. Choose a specific small or medium business sector and a coherent investment strategy. Vary sector, geography and financial ranges each time. Do not name real targets or claim actual buyer credentials. Begin the name with Test mandate."} Use Australian English and AUD. Return the requested JSON with a readable acquisition brief, investment thesis, exploratory outreach positioning and every criterion. The prose and criteria must agree. Separate alternative subsectors with semicolons. Geography must use National or comma-separated Australian state codes. When revenue, revenueCeiling, ebitda or headcount is supplied, use numeric values or ranges (e.g. 5000000–20000000); ensure ascending ranges, revenueCeiling >= revenue maximum and EBITDA below revenue. Criteria: ${criterionDefinitions.map(([key, label]) => `${key}: ${label}`).join("; ")}.` },
    { role: "user", content: description ? `Create a mandate from this buyer description: ${description}` : `Generate a new acquisition brief. Variation seed: ${crypto.randomUUID()}` },
  ];
  const json_schema = z.toJSONSchema(generatedSchema);
  let result: { response: unknown };
  if (description && process.env.OPENAI_API_KEY) {
    // The home form is interactive: avoid a 45-second free-model waterfall before trying OpenAI.
    result = await completeOpenAiJson({ operation: "mandate_generation", messages, json_schema, max_tokens: 4000, timeoutMs: 30000 });
  } else {
    try {
      result = await ai.complete({ operation: "mandate_generation", messages, max_tokens: 4000, temperature: 0.9, reasoning_effort: "none", response_format: { type: "json_schema", json_schema } });
    } catch (error) {
      if (!process.env.OPENAI_API_KEY) throw error;
      console.info("research-provider", JSON.stringify({ timestamp: new Date().toISOString(), provider: "openai", operation: "mandate_generation", event: "paid_fallback_started", model: process.env.OPENAI_MANDATE_MODEL ?? OPENAI_FALLBACK_MODEL }));
      result = await completeOpenAiJson({ operation: "mandate_generation", messages, json_schema, max_tokens: 4000 });
    }
  }
  const generated = generatedSchema.parse(result.response);
  const initial = emptyBrief();
  return briefSchema.parse({
    ...initial,
    ...generated,
    naturalLanguage: description || generated.naturalLanguage,
    criteria: initial.criteria.map(c => {
      const value = generated.criteria[c.key].trim();
      const unknown = Boolean(description) && /^(unknown|unspecified|not specified|not provided|tbd|n\/a)$/i.test(value);
      if (unknown && c.key === "geography") return { ...c, value: "National", state: "unrestricted" as const, origin: "assumed" as const, confirmed: false };
      return { ...c, value: unknown ? "" : value, state: unknown ? "unknown" as const : "specified" as const, origin: "assumed" as const, confirmed: false };
    }),
  });
}
