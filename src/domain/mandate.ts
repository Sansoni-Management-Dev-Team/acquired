import { z } from "zod";
import type { Mandate } from "./models";

export const mandateSchema = z.object({
  sectors: z.array(z.string().min(1)).min(1),
  states: z.array(z.enum(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"])).min(1),
  revenue: z.object({ min: z.number().nonnegative(), max: z.number().positive() }),
  ebitda: z.object({ min: z.number().nonnegative(), max: z.number().positive() }),
  headcount: z.object({ min: z.number().int().nonnegative(), max: z.number().int().positive() }).optional(),
}).refine((value) => value.revenue.min <= value.revenue.max && value.ebitda.min <= value.ebitda.max, {
  message: "Mandate ranges must have a minimum below the maximum",
});

const stateNames: Record<string, string> = {
  "new south wales": "NSW", victoria: "VIC", queensland: "QLD", "south australia": "SA",
  "western australia": "WA", tasmania: "TAS", "northern territory": "NT", "australian capital territory": "ACT",
};

function money(value: string, unit?: string) {
  const multiplier = unit?.toLowerCase().startsWith("b") ? 1_000_000_000 : unit?.toLowerCase().startsWith("m") ? 1_000_000 : 1;
  return Number(value.replace(/,/g, "")) * multiplier;
}

function range(text: string, label: "revenue" | "ebitda", fallback: { min: number; max: number }) {
  const match = text.match(new RegExp(`${label}[^.\\n]{0,35}?(?:between|of|:)?.*?\\$?([\\d,.]+)\\s*(m|million|b|billion)?\\s*(?:-|to|and)\\s*\\$?([\\d,.]+)\\s*(m|million|b|billion)?`, "i"));
  return match ? { min: money(match[1], match[2] || match[4]), max: money(match[3], match[4] || match[2]) } : fallback;
}

export function parseMandate(text: string): Mandate {
  const lower = text.toLowerCase();
  const states = new Set<string>();
  for (const abbreviation of ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]) {
    if (new RegExp(`\\b${abbreviation}\\b`, "i").test(text)) states.add(abbreviation);
  }
  for (const [name, abbreviation] of Object.entries(stateNames)) if (lower.includes(name)) states.add(abbreviation);

  const sectorMatch = text.match(/(?:find|seeking|targeting|in|across|sectors?[: ])\s+([a-z][a-z &/-]+?)(?=\s+(?:businesses|companies|in|across|with)|[,.]|$)/i);
  const sectors = sectorMatch
    ? sectorMatch[1].split(/\s*(?:\/|,| and )\s*/i).map((value) => value.trim()).filter(Boolean)
    : ["Mechanical services"];
  const headcountMatch = text.match(/headcount[^\d]{0,10}(\d+)\s*(?:-|to|and)\s*(\d+)/i);

  return mandateSchema.parse({
    sectors,
    states: states.size ? [...states] : ["VIC", "NSW", "QLD"],
    revenue: range(text, "revenue", { min: 10_000_000, max: 50_000_000 }),
    ebitda: range(text, "ebitda", { min: 1_000_000, max: 5_000_000 }),
    headcount: headcountMatch ? { min: Number(headcountMatch[1]), max: Number(headcountMatch[2]) } : undefined,
  });
}

export function mandateConfirmation(mandate: Mandate) {
  const millions = (value: number) => `$${value / 1_000_000}m`;
  return `${mandate.sectors.join(" or ")} businesses in ${mandate.states.join(", ")}, with revenue of ${millions(mandate.revenue.min)}–${millions(mandate.revenue.max)} and EBITDA of ${millions(mandate.ebitda.min)}–${millions(mandate.ebitda.max)}.`;
}
