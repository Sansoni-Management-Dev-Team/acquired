import { describe, expect, it } from "vitest";
import { contactEnrichmentProgress, type ContactEnrichmentRun } from "./contact-enrichment";
const run: ContactEnrichmentRun = { id: "new", targetId: "company", status: "running", companyStatus: "complete", searchStatus: "running", profilesFound: 2, profilesSaved: 0, profilesFailed: 0, message: "Finding people" };
describe("contact enrichment progress", () => {
  it("tracks company resolution, people search and profile checks", () => {
    expect(contactEnrichmentProgress([], []).stage).toBe(0);
    expect(contactEnrichmentProgress([{ ...run, status: "queued" }], [run.id]).stage).toBe(0);
    expect(contactEnrichmentProgress([run], [run.id]).stage).toBe(1);
    expect(contactEnrichmentProgress([{ ...run, companyStatus: "failed" }], [run.id]).stage).toBe(1);
    expect(contactEnrichmentProgress([{ ...run, searchStatus: "complete" }], [run.id]).stage).toBe(2);
  });
  it("waits for every requested run and ignores older enrichment", () => {
    expect(contactEnrichmentProgress([{ ...run, id: "old", status: "complete" }], [run.id]).finished).toBe(false);
    expect(contactEnrichmentProgress([{ ...run, status: "complete" }], [run.id, "second"]).finished).toBe(false);
    expect(contactEnrichmentProgress([{ ...run, status: "complete" }, { ...run, id: "second" }], [run.id, "second"]).finished).toBe(false);
  });
  it("opens the results for partial and empty completed batches", () => {
    expect(contactEnrichmentProgress([{ ...run, status: "partial", profilesSaved: 1 }], [run.id])).toMatchObject({ finished: true, failed: false, saved: 1, stage: 3 });
    expect(contactEnrichmentProgress([{ ...run, status: "complete", profilesFound: 0 }], [run.id])).toMatchObject({ finished: true, failed: false, saved: 0 });
  });
  it("keeps an entirely failed batch on the failure screen", () => {
    expect(contactEnrichmentProgress([{ ...run, status: "failed" }], [run.id])).toMatchObject({ finished: true, failed: true });
  });
  it("shows the stage that failed instead of marking unfinished stages complete", () => {
    expect(contactEnrichmentProgress([{ ...run, status: "failed", companyStatus: "running" }], [run.id]).stage).toBe(0);
    expect(contactEnrichmentProgress([{ ...run, status: "failed", companyStatus: "failed" }], [run.id]).stage).toBe(0);
    expect(contactEnrichmentProgress([{ ...run, status: "failed" }], [run.id]).stage).toBe(1);
    expect(contactEnrichmentProgress([{ ...run, status: "failed", searchStatus: "complete" }], [run.id]).stage).toBe(2);
  });
});
