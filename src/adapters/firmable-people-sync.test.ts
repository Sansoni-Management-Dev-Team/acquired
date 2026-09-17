import { describe, expect, it, vi } from "vitest";
import { syncAllFirmablePeople } from "./firmable-people-sync";
import type { PersonCandidate, PersonDetail } from "./source-contracts";

const candidate = (id: string): PersonCandidate => ({ id, emailAvailable: false, phoneAvailable: false });
const person = (id: string): PersonDetail => ({ ...candidate(id), name: `Person ${id}`, fictionalised: false, doNotContact: false });

describe("syncAllFirmablePeople", () => {
  it("enriches and saves every search result", async () => {
    const candidates = [candidate("p1"), candidate("p2"), candidate("p3")];
    const firmable = {
      searchAllPeople: vi.fn(async () => candidates),
      enrichPerson: vi.fn(async ({ id }: { id?: string }) => person(id || "")),
    };
    const savedIds: string[] = [];
    const save = vi.fn(async (savedPerson: PersonDetail) => { savedIds.push(savedPerson.id); });

    await expect(syncAllFirmablePeople(firmable, "c1", save, 2)).resolves.toEqual({ found: 3, saved: 3, failed: 0 });
    expect(firmable.enrichPerson).toHaveBeenCalledTimes(3);
    expect(savedIds).toEqual(["p1", "p2", "p3"]);
  });

  it("continues when an individual profile fails", async () => {
    const candidates = [candidate("p1"), candidate("p2")];
    const firmable = {
      searchAllPeople: vi.fn(async () => candidates),
      enrichPerson: vi.fn(async ({ id }: { id?: string }) => {
        if (id === "p1") throw new Error("profile unavailable");
        return person(id || "");
      }),
    };

    await expect(syncAllFirmablePeople(firmable, "c1", async () => undefined)).resolves.toEqual({ found: 2, saved: 1, failed: 1 });
  });
});
