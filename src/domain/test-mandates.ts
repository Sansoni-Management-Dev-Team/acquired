import { briefSchema, type AcquisitionBrief } from "./acquisition";
import savedExamples from "@/data/saved-test-mandates.json";
import newExamples from "@/data/new-test-mandates.json";

export const testMandates: AcquisitionBrief[] = [...savedExamples, ...newExamples].map(example => briefSchema.parse(example));
const storageKey = "acquired.test-mandate-cycle.v1";

function shuffledIndices() {
  const indices = testMandates.map((_, index) => index);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

export function nextTestMandate(): AcquisitionBrief {
  let remaining: number[] = [];
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKey) || "[]");
    if (Array.isArray(parsed) && parsed.every(value => Number.isInteger(value) && value >= 0 && value < testMandates.length) && new Set(parsed).size === parsed.length) remaining = parsed;
  } catch { /* Restart the cycle when browser storage is unavailable. */ }
  if (!remaining.length) remaining = shuffledIndices();
  const index = remaining.shift()!;
  try { sessionStorage.setItem(storageKey, JSON.stringify(remaining)); } catch { /* The current click still works without storage. */ }
  return structuredClone(testMandates[index]);
}
