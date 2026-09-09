import { expect } from "vitest";
import { MERCURY_FALLBACK_MODEL, type FreeResearchUsage } from "./free-openrouter";

// Explicit live-test mode: simulate free exhaustion, then make a real paid call.
export const liveFetch: typeof fetch = async (url, init) => {
  const body = JSON.parse(String(init?.body || "{}"));
  if (process.env.OPENROUTER_LIVE_FORCE_MERCURY === "1" && body.models?.[0] !== MERCURY_FALLBACK_MODEL) return Response.json({ error: { code: 429, message: "Simulated free quota exhaustion for fallback validation" } }, { status: 429 });
  return globalThis.fetch(url, init);
};
export function checkLiveUsage(usage: FreeResearchUsage) {
  console.info("live-inference-usage", JSON.stringify(usage));
  expect(usage.cost).not.toBeNull();
  expect(usage.cost).toBeGreaterThanOrEqual(0);
  if (process.env.OPENROUTER_LIVE_FORCE_MERCURY === "1") {
    expect(usage.model).toBe(MERCURY_FALLBACK_MODEL);
    expect(usage.paidFallback).toBe(true);
  }
}
