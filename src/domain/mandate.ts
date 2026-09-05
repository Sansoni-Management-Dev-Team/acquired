import { z } from "zod";
import type { Mandate } from "./models";

export const mandateSchema = z.object({
  sectors: z.array(z.string().min(1)).min(1),
  states: z.array(z.enum(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"])).min(1),
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
  const amount = "\\$?([\\d,.]+)\\s*(m|million|b|billion)?";
  const separator = "(?:-|to|and)";
  const afterLabel = normalised.match(new RegExp(`${label}[^.\\n]{0,35}?${amount}\\s*${separator}\\s*${amount}`, "i"));
  const beforeLabel = normalised.match(new RegExp(`${amount}\\s*${separator}\\s*${amount}[^.\\n]{0,20}?${label}`, "i"));
  const match = afterLabel || beforeLabel;
  if (match) return { min: money(match[1], match[2] || match[4]), max: money(match[3], match[4] || match[2]) };
  const minimum = normalised.match(new RegExp(`(?:at least|minimum(?: of)?)\\s*${amount}[^.\\n]{0,20}?${label}|${label}[^.\\n]{0,25}?(?:at least|minimum(?: of)?)\\s*${amount}`, "i"));
  if (minimum) {
    const value = minimum[1] || minimum[3];
    const unit = minimum[2] || minimum[4];
    return { min: money(value, unit), max: null };
  }
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
    : ["Mechanical services"];
  const headcountMatch = text.match(/headcount[^\d]{0,10}(\d+)\s*(?:-|to|and)\s*(\d+)/i);

  return mandateSchema.parse({
    sectors,
    states: states.size ? [...states] : ["VIC", "NSW", "QLD"],
    locations: locations.length ? locations : undefined,
    revenue: range(text, "revenue", { min: 10_000_000, max: 50_000_000 }),
    ebitda: range(text, "ebitda", { min: 1_000_000, max: 5_000_000 }),
    headcount: headcountMatch ? { min: Number(headcountMatch[1]), max: Number(headcountMatch[2]) } : undefined,
  });
}

export function mandateConfirmation(mandate: Mandate) {
  const millions = (value: number) => `$${value / 1_000_000}m`;
  const displayRange = (value: { min: number; max: number | null }) => value.max === null ? `${millions(value.min)}+` : `${millions(value.min)}–${millions(value.max)}`;
  return `${mandate.sectors.join(" or ")} businesses in ${(mandate.locations?.length ? mandate.locations : mandate.states).join(", ")}, with revenue of ${displayRange(mandate.revenue)} and EBITDA of ${displayRange(mandate.ebitda)}.`;
}
