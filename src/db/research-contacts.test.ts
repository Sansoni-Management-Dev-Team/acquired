import { describe, expect, it, vi } from "vitest";
vi.mock("./client", () => ({ requireDb: vi.fn() }));
import { saveResearchContact } from "./research-contacts";

function fixture(existing: unknown[] = []) {
  const insert = vi.fn().mockResolvedValue(undefined);
  const update = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  const database = {
    select: () => ({ from: () => ({ where: async () => existing }) }),
    insert: () => ({ values: insert }),
    update: () => ({ set: update }),
  };
  const args = {
    database: database as unknown as Parameters<typeof saveResearchContact>[0]["database"],
    organizationId: "org", targetId: "target", sourceUrl: "https://company.example/team",
    observedAt: new Date("2026-09-30T00:00:00Z"),
    evidence: { kind: "person" as const, name: "Alex Owner", value: "Director", quote: "Alex Owner, Director, alex@company.example", website: "https://company.example/team", relevance: "unclear" as const, email: "alex@company.example" },
  };
  return { args, insert, update };
}

describe("research contacts", () => {
  it("automatically saves a person with a published email and source attribution", async () => {
    const { args, insert } = fixture();
    await saveResearchContact(args);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org", targetId: "target", displayName: "Alex Owner",
      personalData: { email: "alex@company.example", emailStatus: "published-unverified", doNotContact: false },
      provenance: expect.objectContaining({ sourceUrl: args.sourceUrl, quote: args.evidence.quote }),
    }));
  });
  it.each([undefined, "", "invalid"])("keeps email %s as evidence only", async email => {
    const { args, insert, update } = fixture();
    await saveResearchContact({ ...args, evidence: { ...args.evidence, email } });
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it("fills an incomplete contact's email while retaining do-not-contact", async () => {
    const { args, insert, update } = fixture([{ id: "existing", displayName: " Alex   Owner ", personalData: { doNotContact: true, phone: "123" }, fictionalised: false }]);
    await saveResearchContact(args);
    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ personalData: { doNotContact: true, phone: "123", email: "alex@company.example", emailStatus: "published-unverified" } });
  });
  it.each([
    { personalData: { email: "enriched@company.example" } },
    { firmablePersonId: "firmable-id", personalData: {} },
    { fictionalised: true, personalData: {} },
  ])("preserves enriched or fictionalised contacts: %j", async fields => {
    const { args, insert, update } = fixture([{ id: "existing", displayName: "Alex Owner", ...fields }]);
    await saveResearchContact(args);
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
