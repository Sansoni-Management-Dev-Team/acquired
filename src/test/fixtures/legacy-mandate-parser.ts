/** Legacy text parsing retained only to construct existing adapter test fixtures.
 * Application mandate creation uses acquisition briefs and the native command flow. */
import { z } from "zod";
import type { Mandate } from "@/domain/models";

export const mandateSchema = z.object({
  unknownFields: z.array(z.string()).optional(),
  requirements: z.array(z.string()).optional(),
  sectors: z.array(z.string().min(1)),
  states: z.array(z.enum(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"])),
  locations: z.array(z.string().min(1)).optional(),
  revenue: z.object({ min: z.number().nonnegative(), max: z.number().positive().nullable() }),
  ebitda: z.object({ min: z.number().nonnegative(), max: z.number().positive().nullable() }),
  headcount: z.object({ min: z.number().int().nonnegative(), max: z.number().int().positive() }).optional(),
}).refine((value) => (value.revenue.max === null || value.revenue.min <= value.revenue.max) && (value.ebitda.max === null || value.ebitda.min <= value.ebitda.max), {
  message: "Mandate ranges must have a minimum below the maximum",
});

const stateNames: Record<string, string> = {
  "new south wales": "NSW", victoria: "VIC", queensland: "QLD", "south australia": "SA",
  "western australia": "WA", tasmania: "TAS", "northern territory": "NT", "australian capital territory": "ACT",
};

const cities: Record<string, string> = {
  adelaide: "SA", brisbane: "QLD", canberra: "ACT", darwin: "NT", geelong: "VIC",
  hobart: "TAS", melbourne: "VIC", newcastle: "NSW", perth: "WA", sydney: "NSW",
};

// Sector nouns that terminate the phrase being acquired. The last one in the
// sentence is used as the boundary so alternative lists keep each part's noun.
const sectorType =
  "business(?:es)?|companies?|manufactur(?:e|es|ing|ers?)?|producers?|suppliers?|distributors?|wholesalers?|retailers?|providers?|packagers?|baker(?:ies|y)|confectioners?|foundr(?:ies|y)|processors?|fabricators?|makers?|workshops?|studios?|laborator(?:ies|y)|importers?|operators?|farms?|brewer(?:y|ies)?|distillers?|mill(?:ers|s)?";
const manufacturingFamily = /manufactur/i;
// Opening words that describe the size, ownership or quality of the target and
// belong to the acquisition intent rather than the industry.
const sectorLeadingNoise = new Set([
  "small", "medium", "mediumsized", "midsized", "mid", "micro", "microsized", "large", "larger", "big",
  "australian", "australiawide", "national", "local", "interstate",
  "profitable", "established", "wellestablished", "longestablished", "successful", "leading", "growing",
  "highgrowth", "familyowned", "familyrun", "owneroperated", "owned", "operated", "private", "independent",
  "thriving", "wellrun", "reputable", "premium", "quality", "reliable", "boutique",
]);
const sectorConnectors = new Set(["to", "of", "the", "a", "an", "and", "or", "sized", "size", "with", "&"]);
const locationTokens = new Set([
  ...Object.keys(stateNames), ...Object.keys(cities),
  "act", "nsw", "nt", "qld", "sa", "tas", "vic", "wa",
]);
function cleanSector(value: string) {
  const tokens = value.trim().toLowerCase().split(/\s+/);
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index].replace(/[^a-z]/g, "");
    if (sectorLeadingNoise.has(token) || sectorConnectors.has(token)) {
      index += 1;
      continue;
    }
    break;
  }
  return tokens.slice(index).join(" ").replace(/-/g, " ");
}
function standardiseSector(part: string) {
  const noun = part.match(new RegExp(`^(.+?)\\s+(${sectorType})\\b$`, "i"));
  if (!noun) return cleanSector(part);
  const base = cleanSector(noun[1]);
  const type = noun[2].toLowerCase();
  if (!base) return ["business", "businesses", "company", "companies"].includes(type) ? "" : type;
  if (["business", "businesses", "company", "companies"].includes(type)) return base;
  if (manufacturingFamily.test(type) && !/\bmanufactur/i.test(base)) return `${base} manufacturing`;
  return `${base} ${type === "manufacture" ? "manufacturing" : type}`;
}

function money(value: string, unit?: string) {
  const multiplier = unit?.toLowerCase().startsWith("b") ? 1_000_000_000 : unit?.toLowerCase().startsWith("m") ? 1_000_000 : 1;
  return Number(value.replace(/,/g, "")) * multiplier;
}

function range(text: string, label: "revenue" | "ebitda", fallback: { min: number; max: number | null }) {
  const normalised = text.replace(/[–—]/g, "-");
  const amount = "\\$?([\\d,]+(?:\\.\\d+)?)\\s*(million|billion|m|b)?";
  // Adjacent expressions only: never cross another criterion looking for a number.
  const qualifier = "\\s*(?:(?:of|between|is|approximately|around|annual)\\s+)*";
  const after = normalised.match(new RegExp(`\\b${label}\\b${qualifier}${amount}\\s*(?:-|to|and)\\s*${amount}`, "i"));
  const before = normalised.match(new RegExp(`${amount}\\s*(?:-|to|and)\\s*${amount}\\s*(?:annual\\s+)?${label}\\b`, "i"));
  const match = after || before;
  if (match) return { min: money(match[1], match[2] || match[4]), max: money(match[3], match[4] || match[2]) };
  const minimumAfter = normalised.match(new RegExp(`\\b${label}\\b${qualifier}(?:at least|minimum(?: of)?)\\s*${amount}`, "i"));
  const minimumBefore = normalised.match(new RegExp(`(?:at least|minimum(?: of)?)\\s*${amount}\\s*${label}\\b`, "i"));
  const plusAfter = normalised.match(new RegExp(`\\b${label}\\b${qualifier}${amount}\\s*(?:\\+|and above)`, "i"));
  const plusBefore = normalised.match(new RegExp(`${amount}\\s*(?:\\+|and above)\\s*${label}\\b`, "i"));
  const minimum = minimumAfter || minimumBefore || plusAfter || plusBefore;
  if (minimum) return { min: money(minimum[1], minimum[2]), max: null };
  return fallback;
}

export function parseMandate(text: string): Mandate {
  const lower = text.toLowerCase();
  const states = new Set<string>();
  const locations: string[] = [];
  for (const abbreviation of ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]) {
    if (new RegExp(`\\b${abbreviation}\\b`, "i").test(text)) states.add(abbreviation);
  }
  for (const [name, abbreviation] of Object.entries(stateNames)) if (lower.includes(name)) states.add(abbreviation);
  for (const [city, abbreviation] of Object.entries(cities)) {
    if (new RegExp(`\\b${city}\\b`, "i").test(text)) {
      states.add(abbreviation);
      locations.push(`${city[0].toUpperCase()}${city.slice(1)}`);
    }
  }

  const sectorVerb =
    "(?:looking\\s+to\\s+(?:buy|acquire)|looking\\s+for|searching\\s+for|(?:want|hope|wish|intend)\\s+to\\s+acquire|seek(?:ing|s)?\\s+(?:to\\s+(?:acquire|buy))?|seeking|targeting|buying|acquiring|\\bbuy\\b|\\bfind\\b|\\bacquire\\b|\\bsearch\\b)";
  const sectorMatch = text.match(new RegExp(`${sectorVerb}\\s+(?:an|a)?\\b\\s*([a-z][a-z &/-]*)\\s+(${sectorType})\\b`, "i"));
  const contextualSectorMatch = text.match(/(?:in|across|sectors?[: ])\s+([a-z][a-z &/-]+?)(?=\s+(?:businesses|companies|in|across|with)|[,.]|$)/i);
  const extractParts = (phrase: string) => phrase.split(/\s*(?:\/|,|;|\bor\b|\band\b)\s*/i).map(standardiseSector).filter((value) => value && !locationTokens.has(value.replace(/[^a-z]/g, "")));
  const sectors = sectorMatch
    ? extractParts(`${sectorMatch[1]} ${sectorMatch[2]}`)
    : /\bmanufactur(?:e|er|ers|ing)\b/i.test(text)
    ? ["Manufacturing"]
    : contextualSectorMatch
    ? extractParts(contextualSectorMatch[1])
    : [];
  if (/national|australia-wide/i.test(text)) for (const state of ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]) states.add(state);
  const revenue = range(text, "revenue", { min: 0, max: null });
  const ebitda = range(text, "ebitda", { min: 0, max: null });
  const headcountMatch = text.match(/headcount[^\d]{0,10}(\d+)\s*(?:-|to|and)\s*(\d+)/i);

  return mandateSchema.parse({
    unknownFields: [...(!states.size ? ["geography"] : []), ...(!sectors.length ? ["subsectors"] : []), ...(revenue.min === 0 && revenue.max === null ? ["revenue"] : []), ...(ebitda.min === 0 && ebitda.max === null ? ["ebitda"] : [])],
    sectors,
    states: [...states],
    locations: locations.length ? locations : undefined,
    revenue,
    ebitda,
    headcount: headcountMatch ? { min: Number(headcountMatch[1]), max: Number(headcountMatch[2]) } : undefined,
  });
}

export function mandateConfirmation(mandate: Mandate) {
  const millions = (value: number) => `$${value / 1_000_000}m`;
  const displayRange = (value: { min: number; max: number | null }) => value.max === null ? `${millions(value.min)}+` : `${millions(value.min)}–${millions(value.max)}`;
  return `${mandate.sectors.join(" or ")} businesses in ${(mandate.locations?.length ? mandate.locations : mandate.states).join(", ")}, with revenue ${mandate.unknownFields?.includes("revenue") ? "unknown" : displayRange(mandate.revenue)} and EBITDA ${mandate.unknownFields?.includes("ebitda") ? "unknown" : displayRange(mandate.ebitda)}.`;
}
