import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { campaignDefinition, campaignFirstStepIndex, campaignStepEntries, nextCampaignStepAfter, nextAllowedCampaignSend, campaignSendWindowOpen, acceptancePath, renderCampaignTemplate, type CampaignDefinition, type CampaignStep } from "./campaign";
import { campaignHistoryReducer, copyCampaignNode, pasteCampaignNode, reconnectCampaign, parseCampaignClipboard } from "./campaign-editor";
const message = (kind: "email" | "linkedin" | "whatsapp" = "email"): CampaignStep => {
  const base = { id: randomUUID(), title: "Follow up", body: "Hello" };
  return kind === "email" ? { ...base, kind, subject: "Hi" } : { ...base, kind };
};
const wait = (days = 1): CampaignStep => ({ id: randomUUID(), kind: "wait", title: "Wait", days });
const chain = (n: number): CampaignStep[] => Array.from({ length: n }, (_, i) => i % 2 ? wait(i % 30 + 1) : message((["email", "linkedin", "whatsapp"] as const)[i % 3]));

describe("sequence input attacks", () => {
  it.each([undefined, "message"])("enforces message length with LinkedIn action %s", action => {
    expect(campaignDefinition.safeParse({ schemaVersion: 1, steps: [{ ...message("linkedin"), action, body: "x".repeat(4001) }] }).success).toBe(false);
  });
  it.each([0, -1, 31, 1.5, NaN, Infinity, "3", null])("rejects wait duration %s", days => {
    expect(campaignDefinition.safeParse({ schemaVersion: 1, steps: [message(), { ...wait(), days }, message()] }).success).toBe(false);
  });
  it.each([[], [wait()], [message(), wait()], [message(), message()], [message(), wait(), wait(), message()]].map(steps => ({ steps })))("rejects malformed chain %#", ({ steps }) => {
    expect(campaignDefinition.safeParse({ schemaVersion: 1, steps }).success).toBe(false);
  });
  it("rejects hidden owner fields, unknown kinds, invalid coordinates and excessive graphs", () => {
    for (const step of [{ ...message(), ownerUserId: "attacker" }, { ...message(), kind: "sms" }, { ...message(), position: { x: Infinity, y: 0 } }])
      expect(campaignDefinition.safeParse({ schemaVersion: 1, steps: [step] }).success).toBe(false);
    expect(campaignDefinition.safeParse({ schemaVersion: 1, steps: chain(27) }).success).toBe(false);
  });
  it("rejects reused branch IDs, duplicate anchors and conditional branches on email", () => {
    const first = message(); const pathA = [wait(), message()];
    const split = { id: randomUUID(), title: "Split", afterStepId: first.id, percentage: 50, pathA, pathB: [wait(), message()] };
    for (const splits of [[{ ...split, pathB: pathA }], [split, { ...split, id: randomUUID() }], [{ ...split, condition: { kind: "linkedin_connected", timeoutDays: 1 } }]])
      expect(campaignDefinition.safeParse({ schemaVersion: 1, steps: [first], splits }).success).toBe(false);
  });
  it.each([true, false, null])("handles acceptance boundary without inventing evidence: %s", connected => {
    const sent = new Date("2026-10-01T00:00:00Z"); const boundary = new Date("2026-10-08T00:00:00Z");
    expect(acceptancePath(connected, sent, 7, new Date(boundary.getTime() - 1))).toBe(connected ? "pathA" : null);
    expect(acceptancePath(connected, sent, 7, boundary)).toBe(connected === null ? null : connected ? "pathA" : "pathB");
  });
  it("substitutes placeholders literally without interpreting replacement metacharacters", () => {
    expect(renderCampaignTemplate("{{full_name}} {{company_name}}", { displayName: "$& {{company_name}}", companyName: "<script>$1</script>" })).toBe("$& {{company_name}} <script>$1</script>");
  });
});

describe("graph traversal and editor invariants", () => {
  for (let sample = 0; sample < 40; sample++) it(`terminates and preserves branch isolation in generated graph ${sample}`, () => {
    const first = message();
    const split = { id: randomUUID(), title: "Split", afterStepId: first.id, percentage: sample % 99 + 1, pathA: [wait(1), ...chain(3)], pathB: [wait(30), ...chain(3)] };
    const definition = campaignDefinition.parse({ schemaVersion: 1, steps: [first, wait(2), ...chain(3)], splits: [split] });
    const entries = campaignStepEntries(definition);
    for (let contact = 0; contact < 12; contact++) {
      const key = `sample-${sample}-contact-${contact}`;
      let index = campaignFirstStepIndex(definition, key); const visited: string[] = [];
      let time = new Date("2026-01-01T00:00:00Z");
      for (let guard = 0; guard <= entries.length; guard++) {
        expect(entries[index].step.kind).not.toBe("wait");
        expect(visited).not.toContain(entries[index].step.id); visited.push(entries[index].step.id);
        const next = nextCampaignStepAfter(definition, index, time, key);
        if (!next) break;
        expect(next.index).toBeGreaterThan(index); expect(next.at.getTime()).toBeGreaterThan(time.getTime());
        time = next.at; index = next.index;
      }
      expect(visited).toHaveLength(5);
      expect(visited.at(-1)).toBe(definition.steps.at(-1)!.id);
      expect(visited.includes(split.pathA[1].id)).not.toBe(visited.includes(split.pathB[1].id));
    }
  });
  it("copies do not mutate originals and pastes never reuse IDs", () => {
    const definition: CampaignDefinition = { schemaVersion: 1, steps: chain(3) }; const snapshot = structuredClone(definition);
    const clipboard = copyCampaignNode(definition, definition.steps[2].id)!;
    const result = pasteCampaignNode(definition, clipboard, definition.steps[2].id);
    expect(campaignDefinition.safeParse(result.draft).success).toBe(true);
    const ids = campaignStepEntries(result.draft).map(x => x.step.id); expect(new Set(ids).size).toBe(ids.length);
    expect(definition).toEqual(snapshot);
  });
  it("rejects invalid reconnections without dropping nodes", () => {
    const definition: CampaignDefinition = { schemaVersion: 1, steps: chain(5) };
    for (const [from, to] of [["missing", definition.steps[1].id], [definition.steps[0].id, definition.steps[0].id], [definition.steps[1].id, definition.steps[3].id]])
      expect(reconnectCampaign(definition, from, to)).toBeNull();
    const moved = reconnectCampaign(definition, definition.steps[4].id, definition.steps[1].id)!;
    expect(campaignDefinition.safeParse(moved).success).toBe(true);
    expect(moved.steps.map(x => x.id).sort()).toEqual(definition.steps.map(x => x.id).sort());
  });
  it("bounds undo history and clears redo after a divergent edit", () => {
    let history = { present: null, past: [], future: [] } as Parameters<typeof campaignHistoryReducer>[0];
    for (let i = 0; i < 150; i++) history = campaignHistoryReducer(history, { type: "edit", draft: { steps: [message()] } });
    expect(history.past).toHaveLength(100);
    history = campaignHistoryReducer(history, { type: "undo" }); expect(history.future).toHaveLength(1);
    history = campaignHistoryReducer(history, { type: "edit", draft: { steps: [message()] } }); expect(history.future).toHaveLength(0);
    expect(campaignHistoryReducer(history, { type: "redo" })).toBe(history);
  });
  it.each([null, [], { acquireSequenceClipboard: 1, kind: "path", steps: [] }, { acquireSequenceClipboard: 1, kind: "message", message: wait(), days: 3 }, { acquireSequenceClipboard: 1, kind: "message", message: message(), days: NaN }])("rejects hostile clipboard %#", value => {
    expect(parseCampaignClipboard(value)).toBeNull();
  });
});

it("always finds a forward business window through leap day and both DST changes", () => {
  for (const anchor of ["2028-02-28T22:00:00Z", "2026-04-03T00:00:00Z", "2026-10-02T00:00:00Z"]) {
    for (let hour = 0; hour < 120; hour += 3) {
      const input = new Date(new Date(anchor).getTime() + hour * 3600000 + 59999); const next = nextAllowedCampaignSend(input);
      expect(next.getTime()).toBeGreaterThanOrEqual(input.getTime());
      expect(next.getTime() - input.getTime()).toBeLessThan(4 * 86400000);
      expect(campaignSendWindowOpen(next)).toBe(true); expect(nextAllowedCampaignSend(next)).toEqual(next);
    }
  }
});
