import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { campaignDefinition, campaignStepEntries, type CampaignDraft, type CampaignStep } from "./campaign";
import { campaignHistoryReducer, copyCampaignNode, insertCampaignMessage, parseCampaignClipboard, pasteCampaignNode, reconnectCampaign } from "./campaign-editor";
const email = (title: string): CampaignStep => ({ id: randomUUID(), kind: "email", title, subject: "Hello", body: "Hi" });
const wait = (): CampaignStep => ({ id: randomUUID(), kind: "wait", title: "Wait", days: 3 });
function fixture(): CampaignDraft {
  const steps = [email("First"), wait(), email("Second"), wait(), email("Third")];
  return { schemaVersion: 1, steps, splits: [{ id: randomUUID(), title: "Split", afterStepId: steps[0].id, percentage: 50, pathA: [wait(), email("A"), wait(), email("A2")], pathB: [wait(), email("B")] }] };
}
const valid = (draft: CampaignDraft) => expect(campaignDefinition.safeParse({ ...draft, schemaVersion: 1 }).success).toBe(true);

describe("sequence editor operations", () => {
  it("inserts at the start, middle, end and within either branch while preserving alternation", () => {
    const draft = fixture(), split = draft.splits![0];
    for (const [source, target] of [["start", draft.steps[0].id], [draft.steps[2].id, draft.steps[3].id], [draft.steps[3].id, draft.steps[4].id], [draft.steps[4].id, "end"], [split.id, split.pathA[0].id], [split.pathB[1].id, draft.steps[1].id], [split.id, draft.steps[1].id]]) {
      const next = insertCampaignMessage(draft, source, target, email("Inserted"));
      valid(next.draft);
      expect(campaignStepEntries(next.draft)).toHaveLength(campaignStepEntries(draft).length + 2);
    }
    const next = insertCampaignMessage(draft, draft.steps[0].id, split.id, email("Before split"));
    valid(next.draft);
    expect(next.draft.splits![0].afterStepId).toBe(next.selectedId);
  });
  it("duplicates messages with fresh IDs and retains the original content and wait", () => {
    const draft = fixture(), selected = draft.splits![0].pathA[1];
    const copied = copyCampaignNode(draft, selected.id)!;
    const next = pasteCampaignNode(draft, copied, selected.id);
    valid(next.draft);
    const steps = campaignStepEntries(next.draft).map(entry => entry.step);
    expect(new Set(steps.map(step => step.id)).size).toBe(steps.length);
    expect(steps.find(step => step.id === next.selectedId)).toMatchObject({ title: selected.title, body: "Hi" });
    expect(next.draft.splits![0].pathB).toEqual(draft.splits![0].pathB);
  });
  it("copies an entire split, adds an anchor if needed, and regenerates every branch ID", () => {
    const draft = fixture(), split = draft.splits![0];
    const next = pasteCampaignNode(draft, copyCampaignNode(draft, split.id)!, split.id);
    valid(next.draft);
    expect(next.draft.splits).toHaveLength(2);
    const copy = next.draft.splits![1];
    expect(copy.percentage).toBe(split.percentage); expect(copy.afterStepId).not.toBe(split.afterStepId);
    expect(copy.pathA.map(step => step.title)).toEqual(split.pathA.map(step => step.title));
    const ids = [...campaignStepEntries(next.draft).map(entry => entry.step.id), ...next.draft.splits!.map(split => split.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(() => pasteCampaignNode(draft, copyCampaignNode(draft, split.id)!, split.pathA[1].id)).toThrow("main-sequence");
  });
  it("copies one branch into another and enforces node limits", () => {
    const draft = fixture(), split = draft.splits![0];
    const next = pasteCampaignNode(draft, { kind: "path", steps: split.pathA }, split.pathB[1].id);
    valid(next.draft);
    expect(next.draft.splits![0].pathB.map(step => step.title)).toEqual(split.pathA.map(step => step.title));
    expect(next.draft.splits![0].pathB[1].id).not.toBe(split.pathA[1].id);
    const full = { steps: [email("First"), ...Array.from({ length: 12 }, () => [wait(), email("Next")]).flat()] };
    expect(() => insertCampaignMessage(full, full.steps.at(-1)!.id, "end", email("Overflow"))).toThrow("25");
  });
  it("validates external clipboard payloads", () => {
    const draft = fixture(), copied = copyCampaignNode(draft, draft.steps[2].id)!;
    expect(parseCampaignClipboard({ acquireSequenceClipboard: 1, ...copied })).toEqual(copied);
    expect(parseCampaignClipboard({ acquireSequenceClipboard: 1, kind: "message", message: {}, days: 2 })).toBeNull();
    const introduction = email("Introduction");
    expect(parseCampaignClipboard({ acquireSequenceClipboard: 1, kind: "path", steps: [introduction] })).toEqual({ kind: "path", steps: [introduction] });
    expect(parseCampaignClipboard({ acquireSequenceClipboard: 1, kind: "path", steps: [wait()] })).toBeNull();
    expect(parseCampaignClipboard("random text")).toBeNull();
  });
  it("reconnects pairs within and across paths and rejects invalid or cyclic requests", () => {
    const draft = fixture(), split = draft.splits![0];
    const moved = reconnectCampaign(draft, draft.steps[4].id, draft.steps[1].id)!;
    valid(moved);
    expect(moved.steps.map(step => step.title)).toEqual(["First", "Wait", "Third", "Wait", "Second"]);
    const transferred = reconnectCampaign(draft, split.pathB[1].id, split.pathA[2].id)!;
    valid(transferred);
    expect(transferred.splits![0].pathA).toHaveLength(2);
    expect(transferred.splits![0].pathB).toHaveLength(4);
    expect(reconnectCampaign(draft, split.pathA[3].id, split.pathB[0].id)).toBeNull();
    expect(reconnectCampaign(draft, draft.steps[2].id, draft.steps[1].id)).toBeNull();
    expect(reconnectCampaign(draft, draft.steps[0].id, draft.steps[0].id)).toBeNull();
    expect(reconnectCampaign(draft, draft.steps[1].id, draft.steps[2].id)).toBeNull();
    const relocated = reconnectCampaign(draft, draft.steps[4].id, split.id)!;
    valid(relocated); expect(relocated.splits![0].afterStepId).toBe(draft.steps[4].id);
  });
  it("undoes and redoes deletion, clears redo after edits and resets on sequence change", () => {
    const draft = fixture(), edited = { ...draft, splits: [] };
    const original = { present: draft, past: [], future: [] };
    const history = campaignHistoryReducer(original, { type: "edit", draft: edited });
    const undone = campaignHistoryReducer(history, { type: "undo" });
    expect(undone.present).toEqual(draft);
    expect(campaignHistoryReducer(undone, { type: "redo" }).present).toEqual(edited);
    expect(campaignHistoryReducer(undone, { type: "edit", draft: { ...draft, steps: [email("Other")] } }).future).toEqual([]);
    expect(campaignHistoryReducer(history, { type: "reset", draft: null })).toEqual({ present: null, past: [], future: [] });
  });
});

it("inserts messages within and before a subscription split without breaking alternation", () => {
  const split = { id: randomUUID(), afterStepId: "start", title: "Initial", percentage: 50, pathA: [email("Intro A")], pathB: [email("Intro B")] };
  const draft: CampaignDraft = { steps: [wait(), email("Shared")], splits: [split] };
  const inPath = insertCampaignMessage(draft, split.id, split.pathA[0].id, email("New intro"));
  expect(campaignDefinition.safeParse({ ...inPath.draft, schemaVersion: 1 }).success).toBe(true);
  expect(inPath.draft.splits![0].pathA.map(step => step.kind)).toEqual(["email", "wait", "email"]);
  const before = insertCampaignMessage(draft, "start", split.id, email("Before split"));
  expect(campaignDefinition.safeParse({ ...before.draft, schemaVersion: 1 }).success).toBe(true);
  expect(before.draft.splits![0].afterStepId).toBe(before.selectedId);
  expect(before.draft.splits![0].pathA.map(step => step.kind)).toEqual(["wait", "email"]);
  const shared = insertCampaignMessage(draft, split.id, draft.steps[0].id, email("Shared follow-up"));
  expect(campaignDefinition.safeParse({ ...shared.draft, schemaVersion: 1 }).success).toBe(true);
});
