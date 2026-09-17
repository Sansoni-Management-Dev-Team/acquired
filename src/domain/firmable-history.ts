import { createHash } from "node:crypto";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

export function responseHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function normalizeFirmableDomain(value: string | undefined | null) {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "") || undefined;
  } catch { return undefined; }
}

export function normalizeFirmableAbn(value: string | undefined | null) {
  const digits = value?.replace(/\D/g, "") || "";
  return digits.length === 11 ? digits : undefined;
}

export function latestSuccessfulObservation<T extends { id: string; successful: boolean; fetchedAt: Date }>(observations: T[]) {
  return observations.filter(observation => observation.successful).sort((left, right) => right.fetchedAt.getTime() - left.fetchedAt.getTime() || right.id.localeCompare(left.id))[0];
}
