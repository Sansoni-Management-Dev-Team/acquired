import { describe, expect, it } from "vitest";
import {
  publicResearchUrl,
  parseResearchExtraction,
  researchStartSchema,
  validateFindings,
  followUpLinks,
} from "./research";
const source = "https://directory.example.com/members";
const page =
  "Example Instruments makes precision sensors. [Example Instruments](https://instruments.example.com/) [Products](/products) [Privacy](/privacy)";
const finding = {
  kind: "company",
  name: "Example Instruments",
  value: "precision sensors",
  quote: "Example Instruments makes precision sensors.",
  website: "https://instruments.example.com/",
};
describe("public research boundaries", () => {
  it.each([
    "http://example.com",
    "https://127.0.0.1",
    "https://[::1]",
    "https://private.internal",
    "https://user:password@example.com",
    "https://example.com:444",
  ])("rejects non-public or credentialed URL %s", (url) =>
    expect(publicResearchUrl(url)).toBeNull(),
  );
  it("removes query credentials and fragments", () =>
    expect(
      publicResearchUrl("https://example.com/products?token=secret#section"),
    ).toBe("https://example.com/products"));
  it("requires approval and enforces hard budgets", () => {
    const config = {
      requestId: "00000000-0000-4000-8000-000000000001",
      seeds: [],
      searchTerms: ["precision sensors"],
      geography: "Australia",
      approved: true,
      budget: { maxPages: 3, maxDomains: 3, maxMinutes: 10, maxModelCalls: 3 },
    };
    expect(researchStartSchema.safeParse(config).success).toBe(true);
    expect(
      researchStartSchema.safeParse({ ...config, approved: false }).success,
    ).toBe(false);
    expect(
      researchStartSchema.safeParse({
        ...config,
        budget: { ...config.budget, maxPages: 6 },
      }).success,
    ).toBe(false);
  });
  it("requires verbatim evidence and an observed website", () => {
    expect(validateFindings([finding], page, source)).toHaveLength(1);
    expect(
      validateFindings(
        [{ ...finding, value: "defence certification" }],
        page,
        source,
      ),
    ).toEqual([]);
    expect(
      validateFindings(
        [{ ...finding, website: "https://invented.example.com/" }],
        page,
        source,
      ),
    ).toEqual([]);
    expect(
      validateFindings(
        [{ ...finding, name: "Unrelated Business" }],
        page,
        source,
      ),
    ).toEqual([]);
  });
  it("follows relevant observed links, excluding navigation and visited URLs", () => {
    expect(followUpLinks(page, source, ["products"], [])).toEqual([
      "https://directory.example.com/products",
    ]);
    expect(
      followUpLinks(
        page,
        source,
        ["products"],
        ["https://directory.example.com/products"],
      ),
    ).toEqual([]);
  });
});

describe("Workers AI extraction formats", () => {
  it("accepts structured JSON mode objects", () => {
    expect(parseResearchExtraction({ response: { findings: [finding] } })).toEqual([finding]);
  });
  it("accepts JSON text and fenced JSON", () => {
    expect(parseResearchExtraction({ response: JSON.stringify({ findings: [finding] }) })).toEqual([finding]);
    expect(parseResearchExtraction({ response: "```json\n{\"findings\":[]}\n```" })).toEqual([]);
  });
  it("rejects malformed or missing findings", () => {
    expect(() => parseResearchExtraction({ response: "Here are some findings" })).toThrow();
    expect(() => parseResearchExtraction({ response: { other: [] } })).toThrow();
  });
});

it("bounds excessive model output without discarding valid quoted claims", () => {
  const records = Array.from({length: 14}, () => finding);
  expect(validateFindings(records, page, source)).toHaveLength(12);
  expect(validateFindings([{invalid: true}, finding], page, source)).toEqual([finding]);
});

it("does not follow obituary, data policy, testimonial or colour-chart detours", () => {
  const source = "https://supplier.example.com/";
  const markdown = ["obituaries/obituary-listings", "howwecollectandstoredata", "testimonials", "perspex-colour-chart", "products"].map(path => `[Supplier products](https://supplier.example.com/${path})`).join("\n");
  expect(followUpLinks(markdown, source, ["supplier products"], [])).toEqual([source + "products"]);
});
