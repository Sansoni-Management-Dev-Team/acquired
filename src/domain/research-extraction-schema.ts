import { peopleExtractionSchema } from "./people-research";

// Shared by the Worker and live extraction checks.
export const researchExtractionSchema = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: [
              "company",
              "business_role",
              "product",
              "customer",
              "person",
              "capability",
              "accreditation",
              "identifier",
            ],
          },
          name: { type: "string" },
          value: { type: "string" },
          quote: { type: "string" },
          website: { type: "string" },
          subject: { type: "string" },
          email: { type: "string" },
          relevance: {
            type: "string",
            enum: ["relevant", "adjacent", "unclear"],
          },
        },
        required: [
          "kind",
          "name",
          "value",
          "quote",
          "website",
          "relevance",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
};

/** Extraction needs source-grounded JSON, without spending its output budget on reasoning. */
export function researchExtractionRequest(messages: { role: string; content: string }[]) {
  return {
    messages,
    operation: messages[0].content.startsWith("Find named business decision-makers") ? "people_extraction" as const : "business_extraction" as const,
    max_tokens: 1200,
    reasoning_effort: "none" as const,
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: messages[0].content.startsWith("Find named business decision-makers") ? peopleExtractionSchema : researchExtractionSchema,
    },
  };
}
