import { expect, test } from "vitest";
import { candidateCrawlPriority, generateQueries, normalizeCandidateUrl, scoreAustralianEvidence, scoreManufacturingEvidence } from "./discover-manufacturers-web.mjs";

test("builds every category, state and evidence-query combination", () => {
  const queries = generateQueries({ categories: ["CNC machining", "food processing"], states: ["VIC", "QLD"] });
  expect(queries).toHaveLength(24);
  expect(new Set(queries.map((query) => query.id)).size).toBe(24);
  expect(queries.some((query) => query.query.includes("manufacturing facility"))).toBe(true);
  expect(queries.some((query) => query.query.includes("site:.com.au"))).toBe(true);
});

test("canonicalizes company URLs and rejects directory or document results", () => {
  expect(normalizeCandidateUrl("https://www.acme.com.au/capabilities?ref=search")).toMatchObject({ domain: "acme.com.au", website: "https://www.acme.com.au/" });
  expect(normalizeCandidateUrl("https://www.yellowpages.com.au/example")).toBeNull();
  expect(normalizeCandidateUrl("https://au.jooble.org/jobs-cnc/Australia")).toBeNull();
  expect(normalizeCandidateUrl("https://example.com/catalogue.pdf")).toBeNull();
});

test("scores first-party Australian production evidence above distributors", () => {
  const manufacturer = scoreManufacturingEvidence("We design and manufacture components at our manufacturing facility in Victoria. Australian Made.");
  const distributor = scoreManufacturingEvidence("We are the exclusive distributor and importer of industrial components.");
  expect(manufacturer.confidence).toBe("high");
  expect(manufacturer.score).toBeGreaterThan(distributor.score);
  expect(distributor.confidence).toBe("low");
});

test("requires evidence that a candidate operates in Australia", () => {
  expect(scoreAustralianEvidence("Contact us in Melbourne VIC 3000", "acme.com").score).toBeGreaterThanOrEqual(30);
  expect(scoreAustralianEvidence("Made in Slovakia", "gazebo-pergola.eu").confidence).toBe("low");
  expect(scoreAustralianEvidence("Contact our team", "acme.com.au").score).toBeGreaterThanOrEqual(30);
});

test("only schedules plausible Australian manufacturers for expensive site crawling", () => {
  const base = { queryIds: ["one"], searchResults: [{ title: "Acme", snippet: "Australian manufacturer of machined parts" }] };
  expect(candidateCrawlPriority({ ...base, domain: "acme.com.au" }).eligible).toBe(true);
  expect(candidateCrawlPriority({ ...base, domain: "acme.eu", searchResults: [{ title: "Acme", snippet: "European manufacturer" }] }).eligible).toBe(false);
});
