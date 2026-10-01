import { campaignDefinition, campaignStep, campaignSplit, campaignStepEntries, type CampaignDraft, type CampaignStep, type CampaignSplit } from "./campaign";

export type CampaignClipboard = { kind: "message"; message: Exclude<CampaignStep, { kind: "wait" }>; days: number } | { kind: "path"; steps: CampaignStep[] } | { kind: "split"; split: CampaignSplit; anchor: Exclude<CampaignStep, { kind: "wait" }> };
export function parseCampaignClipboard(value: unknown): CampaignClipboard | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (data.acquireSequenceClipboard !== 1) return null;
  if (data.kind === "message") {
    const message = campaignStep.safeParse(data.message);
    return message.success && message.data.kind !== "wait" && typeof data.days === "number" && Number.isInteger(data.days) && data.days >= 1 && data.days <= 30 ? { kind: "message", message: message.data, days: data.days } : null;
  }
  if (data.kind === "split") {
    const split = campaignSplit.safeParse(data.split), anchor = campaignStep.safeParse(data.anchor);
    return split.success && anchor.success && anchor.data.kind !== "wait" && campaignDefinition.safeParse({ schemaVersion: 1, steps: [anchor.data], splits: [split.data] }).success ? { kind: "split", split: split.data, anchor: anchor.data } : null;
  }
  if (data.kind === "path" && Array.isArray(data.steps)) {
    const steps = data.steps.map(step => campaignStep.safeParse(step));
    if (steps.some(step => !step.success)) return null;
    const parsed = steps.map(step => step.data!);
    return parsed.length >= 2 && parsed.length <= 24 && parsed[0].kind === "wait" && parsed.at(-1)?.kind !== "wait" && parsed.every((step, index) => index === 0 || (step.kind === "wait") !== (parsed[index - 1].kind === "wait")) ? { kind: "path", steps: parsed } : null;
  }
  return null;
}
export function campaignChain(draft: CampaignDraft, id: string) {
  const entry = campaignStepEntries(draft).find(entry => entry.step.id === id);
  if (!entry) return null;
  return { ...entry, steps: entry.split && entry.path ? entry.split[entry.path] : draft.steps };
}
export function replaceCampaignChain(draft: CampaignDraft, context: ReturnType<typeof campaignChain>, steps: CampaignStep[]): CampaignDraft {
  return context?.split && context.path ? { ...draft, splits: draft.splits?.map(split => split.id === context.split!.id ? { ...split, [context.path!]: steps } : split) } : { ...draft, steps };
}
const cloneStep = (step: CampaignStep) => ({ ...step, id: crypto.randomUUID() });
const wait = (days = 3): CampaignStep => ({ id: crypto.randomUUID(), kind: "wait", title: `Wait ${days} days`, days });
export function copyCampaignNode(draft: CampaignDraft, id: string): CampaignClipboard | null {
  const split = draft.splits?.find(split => split.id === id);
  if (split) {
    const anchor = draft.steps.find(step => step.id === split.afterStepId);
    return anchor && anchor.kind !== "wait" ? structuredClone({ kind: "split", split, anchor }) : null;
  }
  const context = campaignChain(draft, id);
  if (!context) return null;
  const index = context.steps.findIndex(step => step.id === id);
  const message = context.step.kind === "wait" ? context.steps[index + 1] : context.step;
  const previous = context.step.kind === "wait" ? context.step : context.steps[index - 1];
  return message && message.kind !== "wait" ? structuredClone({ kind: "message", message, days: previous?.kind === "wait" ? previous.days : 3 }) : null;
}
export function insertCampaignMessage(draft: CampaignDraft, source: string, target: string, message: CampaignStep, days = 3) {
  if (message.kind === "wait") throw new Error("Choose a message; its wait is added automatically");
  const sourceSplit = draft.splits?.find(split => split.id === source);
  const targetContext = campaignChain(draft, target);
  const startsPath = sourceSplit && targetContext?.split?.id === sourceSplit.id;
  const context = sourceSplit ? startsPath ? targetContext : campaignChain(draft, sourceSplit.afterStepId) : campaignChain(draft, source) || targetContext;
  if (!context) throw new Error("Select a connection in the sequence");
  const steps = [...context.steps];
  const index = source === "start" || startsPath ? 0 : steps.findIndex(step => step.id === (sourceSplit?.afterStepId || source)) + 1;
  const additions = index === 0 && !context.split || steps[index - 1]?.kind === "wait" ? [message, wait(days)] : [wait(days), message];
  // A final message needs only its preceding wait, never a trailing wait.
  if (index === steps.length && additions[0].kind !== "wait") additions.pop();
  steps.splice(index, 0, ...additions);
  let next = replaceCampaignChain(draft, context, steps);
  if (draft.splits?.some(split => split.id === target)) next = { ...next, splits: next.splits?.map(split => split.id === target ? { ...split, afterStepId: message.id } : split) };
  if (campaignStepEntries(next).length > 25) throw new Error("Sequences can contain at most 25 message and wait nodes");
  return { draft: next, selectedId: message.id };
}
export function pasteCampaignNode(draft: CampaignDraft, clipboard: CampaignClipboard, afterId: string | null) {
  if (clipboard.kind === "path") {
    const context = afterId ? campaignChain(draft, afterId) : null;
    if (!context?.split || !context.path) throw new Error("Select a node in the destination path before pasting a branch");
    const steps = clipboard.steps.map(cloneStep);
    const next = replaceCampaignChain(draft, context, steps);
    const parsed = campaignDefinition.safeParse({ ...next, schemaVersion: 1 });
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);
    return { draft: next, selectedId: steps.at(-1)!.id };
  }
  if (clipboard.kind === "message") {
    const split = draft.splits?.find(split => split.id === afterId);
    const source = split?.pathA.at(-1)?.id || afterId || draft.steps.at(-1)?.id;
    if (!source) throw new Error("Select a node to paste after");
    return insertCampaignMessage(draft, source, "", cloneStep(clipboard.message), clipboard.days);
  }
  let next = draft;
  const selectedSplit = draft.splits?.find(split => split.id === afterId);
  let anchor = draft.steps.find(step => step.id === (selectedSplit?.afterStepId || afterId));
  if (!anchor || anchor.kind === "wait") throw new Error("Select a main-sequence message to paste a split");
  if (draft.splits?.some(split => split.afterStepId === anchor!.id)) {
    const copy = cloneStep(clipboard.anchor);
    next = insertCampaignMessage(draft, anchor.id, "", copy).draft;
    anchor = copy;
  }
  const split = { ...clipboard.split, id: crypto.randomUUID(), afterStepId: anchor.id, pathA: clipboard.split.pathA.map(cloneStep), pathB: clipboard.split.pathB.map(cloneStep) };
  next = { ...next, splits: [...(next.splits || []), split] };
  const parsed = campaignDefinition.safeParse({ ...next, schemaVersion: 1 });
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return { draft: next, selectedId: split.id };
}

// Connection editing moves a wait/message pair, preserving all nodes and the
// structured paths consumed by both the application worker and n8n compiler.
export function reconnectCampaign(draft: CampaignDraft, source: string, target: string): CampaignDraft | null {
  if (source === target) return null;
  const split = draft.splits?.find(split => split.id === target);
  let next: CampaignDraft;
  if (split) {
    const anchor = draft.steps.find(step => step.id === source && step.kind !== "wait");
    if (!anchor || anchor.id === split.afterStepId || draft.splits?.some(item => item.id !== split.id && item.afterStepId === source)) return null;
    next = { ...draft, splits: draft.splits?.map(item => item.id === split.id ? { ...item, afterStepId: source } : item) };
  } else {
    const from = campaignChain(draft, source), to = campaignChain(draft, target);
    if (!from || !to || from.step.kind === "wait" || to.step.kind !== "wait") return null;
    const targetIndex = to.steps.findIndex(step => step.id === target);
    const pair = to.steps.slice(targetIndex, targetIndex + 2);
    if (pair.length !== 2 || pair[1].kind === "wait" || pair.some(step => step.id === source)) return null;
    const reduced = to.steps.filter(step => !pair.some(item => item.id === step.id));
    next = replaceCampaignChain(draft, to, reduced);
    const destination = campaignChain(next, source);
    if (!destination) return null;
    const steps = [...destination.steps];
    steps.splice(steps.findIndex(step => step.id === source) + 1, 0, ...pair);
    next = replaceCampaignChain(next, destination, steps);
  }
  if (JSON.stringify(next) === JSON.stringify(draft)) return null;
  return campaignDefinition.safeParse({ ...next, schemaVersion: 1 }).success ? next : null;
}

export type CampaignHistory = { present: CampaignDraft | null; past: (CampaignDraft | null)[]; future: (CampaignDraft | null)[] };
export type CampaignHistoryAction = { type: "edit" | "reset"; draft: CampaignDraft | null } | { type: "undo" | "redo" };
export function campaignHistoryReducer(state: CampaignHistory, action: CampaignHistoryAction): CampaignHistory {
  if (action.type === "reset") return { present: action.draft, past: [], future: [] };
  if (action.type === "edit") return JSON.stringify(state.present) === JSON.stringify(action.draft) ? state : { present: action.draft, past: [...state.past, state.present].slice(-100), future: [] };
  if (action.type === "undo") return !state.past.length ? state : { present: state.past.at(-1)!, past: state.past.slice(0, -1), future: [state.present, ...state.future] };
  return !state.future.length ? state : { present: state.future[0], past: [...state.past, state.present], future: state.future.slice(1) };
}
