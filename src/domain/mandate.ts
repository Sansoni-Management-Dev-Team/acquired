import { z } from "zod";
import type { Mandate } from "./models";

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

  const manufacturerMatch = text.match(/(?:looking\s+(?:to\s+buy|for)|searching\s+for|buy|find|seeking|targeting|acquir(?:e|ing))\s+(?:an?\s+)?([a-z][a-z &/-]*?)\s+manufacturers?\b/i);
  const sectorMatch = text.match(/(?:looking\s+(?:to\s+buy|for)|searching\s+for|buy|find|seeking|targeting|acquir(?:e|ing))\s+(?:an?\s+)?([a-z][a-z &/-]+?)\s+(?:business(?:es)?|compan(?:y|ies))\b/i);
  const contextualSectorMatch = text.match(/(?:in|across|sectors?[: ])\s+([a-z][a-z &/-]+?)(?=\s+(?:businesses|companies|in|across|with)|[,.]|$)/i);
  const sectors = manufacturerMatch
    ? [`${manufacturerMatch[1].trim()} manufacturing`.trim()]
    : sectorMatch
    ? sectorMatch[1].split(/\s*(?:\/|,|\bor\b|\band\b)\s*/i).map((value) => value.replace(/-/g, " ").trim()).filter(Boolean)
    : /\bmanufactur(?:e|er|ers|ing)\b/i.test(text)
    ? ["Manufacturing"]
    : contextualSectorMatch
    ? contextualSectorMatch[1].split(/\s*(?:\/|,|\bor\b|\band\b)\s*/i).map((value) => value.replace(/-/g, " ").trim()).filter(Boolean)
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
