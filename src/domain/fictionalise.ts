export type PersonalData = { name?: string; email?: string; mobile?: string; linkedinUrl?: string };

function stableNumber(seed: string) {
  return [...seed].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 7);
}

export function fictionalisePersonalData(input: PersonalData, seed = input.email || input.name || "contact"): PersonalData {
  const id = stableNumber(seed);
  return {
    name: `Alex ${["Morgan", "Taylor", "Jordan", "Casey"][id % 4]}`,
    email: `alex.${id % 10000}@example.invalid`,
    mobile: `+61 400 000 ${String(id % 1000).padStart(3, "0")}`,
    linkedinUrl: undefined,
  };
}
