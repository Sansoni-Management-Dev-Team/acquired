import { describe, expect, it } from "vitest";
import { latestSuccessfulObservation, normalizeFirmableAbn, normalizeFirmableDomain, responseHash } from "./firmable-history";

describe("Firmable history rules", () => {
  it("normalizes only strong company identifiers", () => {
    expect(normalizeFirmableDomain("HTTPS://WWW.Example.COM.au/path?q=1")).toBe("example.com.au");
    expect(normalizeFirmableDomain("api.example.com.au")).toBe("api.example.com.au");
    expect(normalizeFirmableAbn("12 345 678 901")).toBe("12345678901");
    expect(normalizeFirmableAbn("123")).toBeUndefined();
  });

  it("hashes equivalent object payloads consistently without deduplicating observations", () => {
    expect(responseHash({ b: 2, a: { y: 1, x: 0 } })).toBe(responseHash({ a: { x: 0, y: 1 }, b: 2 }));
    expect(responseHash({ value: null })).not.toBe(responseHash({}));
  });

  it("selects the newest validated success and uses id as a stable tie-breaker", () => {
    const observations = [
      { id: "b", successful: true, fetchedAt: new Date("2026-01-01T00:00:00Z"), response: { value: "second" } },
      { id: "failed", successful: false, fetchedAt: new Date("2026-02-01T00:00:00Z"), response: { value: "bad" } },
      { id: "a", successful: true, fetchedAt: new Date("2026-01-01T00:00:00Z"), response: { value: "first" } },
    ];
    expect(latestSuccessfulObservation(observations)?.id).toBe("b");
  });
});
