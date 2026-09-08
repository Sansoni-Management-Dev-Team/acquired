import { describe, expect, it } from "vitest";
import { accreditationSignals } from "./accreditation-evidence";
import type { Accreditation } from "./acquisition";
const record: Accreditation = { id: "00000000-0000-4000-8000-000000000001", issuer: "Fictional Quality Register", scope: "Packaging assembly", identifier: "EXAMPLE-01", site: "Example site", status: "current", verifiedAt: "2026-01-01", expiresAt: "2026-12-31", source: "Fictional register", sourceUrl: "https://register.example/01", confidence: 95 };
describe("accreditation outreach evidence", () => {
  it("retains scope, site, source, date and confidence in the outreach hook", () => {
    const [signal] = accreditationSignals([record],"2026-09-01");
    expect(signal.value).toContain("Packaging assembly at Example site");
    expect(signal.provenance).toMatchObject({ source: record.source, sourceUrl: record.sourceUrl, confidence: 95 });
  });
  it("does not promote expired, withdrawn or unverified accreditation claims", () => {
    expect(accreditationSignals([{ ...record, status: "withdrawn" }, { ...record, status: "unverified" }, { ...record, confidence: 30 }, { ...record, expiresAt: "2026-01-01" }],"2026-09-01")).toEqual([]);
  });
});
