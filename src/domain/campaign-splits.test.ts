import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { campaignDefinition, campaignFirstStepIndex, campaignNextOptions, campaignPathFor, campaignStepEntries, nextEmailAfter, type CampaignDefinition, type CampaignStep } from "./campaign";

const email = (title: string): CampaignStep => ({ id: randomUUID(), kind: "email", title, subject: "Hello", body: "Hi" });
const wait = (days: number): CampaignStep => ({ id: randomUUID(), kind: "wait", title: "Wait", days });
export function splitDefinition(): CampaignDefinition {
  const first = email("Introduction");
  return { schemaVersion: 1, steps: [first, wait(3), email("Rejoined")], splits: [{ id: randomUUID(), title: "Test split", afterStepId: first.id, percentage: 50, pathA: [wait(1), email("A"), wait(2), email("A again")], pathB: [wait(5), email("B")] }] };
}

describe("split path sequences", () => {
  it("round-trips branches and preserves indices on linear versions", () => {
    const definition = splitDefinition();
    expect(campaignDefinition.parse(JSON.parse(JSON.stringify(definition)))).toEqual(definition);
    expect(campaignStepEntries({ steps: definition.steps }).map(entry => entry.step)).toEqual(definition.steps);
    expect(campaignStepEntries(definition).map(entry => entry.step.title)).toEqual(["Introduction", "Wait", "A", "Wait", "A again", "Wait", "B", "Wait", "Rejoined"]);
  });
  it("assigns both paths reproducibly with their own wait durations and rejoins once", () => {
    const definition = splitDefinition();
    const split = definition.splits![0];
    const time = new Date("2026-10-01T00:00:00Z");
    const keys = Array.from({ length: 500 }, (_, index) => `contact-${index}`);
    const countA = keys.filter(key => campaignPathFor(split, key) === "pathA").length;
    expect(countA).toBeGreaterThan(200); expect(countA).toBeLessThan(300);
    for (const path of ["pathA", "pathB"] as const) {
      const key = keys.find(key => campaignPathFor(split, key) === path)!;
      const next = nextEmailAfter(definition, 0, time, key)!;
      expect(next).toEqual(nextEmailAfter(definition, 0, time, key));
      expect(next.index).toBe(path === "pathA" ? 2 : 6);
      expect(next.at.toISOString()).toBe(path === "pathA" ? "2026-10-02T00:00:00.000Z" : "2026-10-06T00:00:00.000Z");
      const last = path === "pathA" ? 4 : 6;
      expect(nextEmailAfter(definition, last, time, key)).toEqual({ index: 8, at: new Date("2026-10-04T00:00:00Z") });
      expect(nextEmailAfter(definition, 8, time, key)).toBeNull();
    }
    expect(campaignNextOptions(definition, 2)).toEqual([{ index: 4, days: 2 }]);
    expect(() => nextEmailAfter(definition, 0, time)).toThrow("routing key");
    expect(keys.filter(key => campaignPathFor({ ...split, percentage: 20 }, key) === "pathA").length).toBeLessThan(140);
  });
  it("rejects invalid branches, anchors, allocations, duplicates and total node overflow", () => {
    const definition = splitDefinition();
    const split = definition.splits![0];
    for (const invalid of [
      { ...split, percentage: 0 }, { ...split, percentage: 100 },
      { ...split, afterStepId: definition.steps[1].id }, { ...split, afterStepId: randomUUID() },
      { ...split, pathA: [email("No wait")] }, { ...split, pathA: [wait(1), wait(2)] },
      { ...split, pathB: [wait(1), { ...email("Duplicate"), id: definition.steps[0].id }] },
    ]) expect(campaignDefinition.safeParse({ ...definition, splits: [invalid] }).success).toBe(false);
    expect(campaignDefinition.safeParse({ ...definition, splits: [split, { ...split, id: randomUUID() }] }).success).toBe(false);
    const longPath = Array.from({ length: 12 }, () => [wait(1), email("Message")]).flat();
    expect(campaignDefinition.safeParse({ ...definition, splits: [{ ...split, pathA: longPath }] }).success).toBe(false);
  });
  it("supports consecutive splits and splitting after the last main message", () => {
    const definition = splitDefinition();
    const last = definition.steps.at(-1)!;
    definition.splits!.push({ id: randomUUID(), afterStepId: last.id, title: "Final split", percentage: 60, pathA: [wait(2), email("Final A")], pathB: [wait(4), email("Final B")] });
    expect(campaignDefinition.safeParse(definition).success).toBe(true);
    const entries = campaignStepEntries(definition);
    const next = nextEmailAfter(definition, entries.findIndex(entry => entry.step.id === last.id), new Date(), "contact")!;
    expect(nextEmailAfter(definition, next.index, next.at, "contact")).toBeNull();
  });
});

it("saves free canvas positions without changing branch routing", () => {
  const definition = splitDefinition();
  const positioned = { ...definition, steps: definition.steps.map(step => ({ ...step, position: { x: -200, y: 1000 } })), splits: definition.splits!.map(split => ({ ...split, position: { x: 900, y: -50 }, pathA: split.pathA.map(step => ({ ...step, position: { x: 600, y: 400 } })) })) };
  const restored = campaignDefinition.parse(JSON.parse(JSON.stringify(positioned)));
  expect(restored).toEqual(positioned);
  expect(campaignStepEntries(restored).map(entry => entry.step.id)).toEqual(campaignStepEntries(definition).map(entry => entry.step.id));
  const sentAt = new Date("2026-10-01T00:00:00Z");
  expect(nextEmailAfter(restored, 0, sentAt, "contact")).toEqual(nextEmailAfter(definition, 0, sentAt, "contact"));
  expect(campaignDefinition.safeParse({ ...positioned, steps: [{ ...positioned.steps[0], position: { x: Infinity, y: 0 } }] }).success).toBe(false);
});

it("starts on either subscription branch and rejoins the shared sequence after its wait", () => {
  const definition: CampaignDefinition = { schemaVersion: 1, steps: [wait(3), email("Shared")], splits: [{ id: randomUUID(), title: "Initial variants", afterStepId: "start", percentage: 30, pathA: [email("Intro A"), wait(2), email("A follow-up")], pathB: [email("Intro B")] }] };
  expect(campaignDefinition.parse(definition)).toEqual(definition);
  const entries = campaignStepEntries(definition);
  const split = definition.splits![0];
  for (const path of ["pathA", "pathB"] as const) {
    const key = Array.from({ length: 100 }, (_, i) => `contact-${i}`).find(key => campaignPathFor(split, key) === path)!;
    const index = campaignFirstStepIndex(definition, key);
    expect(entries[index].step.id).toBe(split[path][0].id);
    expect(campaignFirstStepIndex(definition, key)).toBe(index);
    const lastIndex = entries.findIndex(entry => entry.step.id === split[path].at(-1)!.id);
    expect(nextEmailAfter(definition, lastIndex, new Date("2026-10-01T00:00:00Z"), key)).toEqual({ index: 5, at: new Date("2026-10-04T00:00:00Z") });
  }
  expect(campaignDefinition.safeParse({ ...definition, steps: definition.steps.slice(1) }).success).toBe(false);
  expect(campaignDefinition.safeParse({ ...definition, splits: [{ ...split, pathA: [wait(1), email("Delayed")] }] }).success).toBe(false);
  expect(campaignDefinition.safeParse({ ...definition, splits: [{ ...split, condition: { kind: "linkedin_connected", timeoutDays: 7 } }] }).success).toBe(false);
  expect(campaignDefinition.safeParse({ ...definition, splits: [split, { ...split, id: randomUUID() }] }).success).toBe(false);
});
