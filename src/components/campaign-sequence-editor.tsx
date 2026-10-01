"use client";

import "@xyflow/react/dist/style.css";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node, type ReactFlowInstance } from "@xyflow/react";
import { Clock3, Mail, MessageCircle, BriefcaseBusiness, Plus, Trash2, GitFork, Copy, ClipboardPaste, Undo2, Redo2, ChevronDown, ChevronUp, Maximize2, Minimize2 } from "lucide-react";
import { campaignDefinition, campaignStepEntries, type CampaignDraft, type CampaignStep, type CampaignSplit } from "@/domain/campaign";

import { copyCampaignNode, parseCampaignClipboard, insertCampaignMessage, pasteCampaignNode, reconnectCampaign, type CampaignClipboard } from "@/domain/campaign-editor";
import { campaignRunStatuses, type CampaignRun } from "@/domain/campaign-run";
import type { CampaignHistoryControls } from "@/hooks/use-campaign-history";
import { campaignEdgeTypes } from "@/components/campaign-insert-edge";

type StepKind = CampaignStep["kind"];
const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 text-sm font-medium hover:bg-[var(--panel-raised)] disabled:cursor-not-allowed disabled:opacity-40";
const field = "mt-1 min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm";
const stepLabels: Record<StepKind, string> = { email: "Email", wait: "Wait", whatsapp: "WhatsApp", linkedin: "LinkedIn" };
const stepIcons = { email: Mail, wait: Clock3, whatsapp: MessageCircle, linkedin: BriefcaseBusiness };
const nodeWidth = 230;
const nodeGap = 120;
const firstNodeY = 110;
const mainX = 260;

function newStep(kind: StepKind): CampaignStep {
  if (kind === "linkedin" || kind === "whatsapp") return { id: crypto.randomUUID(), kind, title: `${stepLabels[kind]} follow-up`, body: "Hi {{first_name}}, would you be open to a short, confidential conversation about {{company_name}}?" };
  return kind === "wait"
    ? { id: crypto.randomUUID(), kind, title: "Wait three days", days: 3 }
    : { id: crypto.randomUUID(), kind, title: "Follow-up", subject: "Following up with {{company_name}}", body: "Hi {{first_name}},\n\nJust following up on my note.\n\nBest regards" };
}

function removalReason(draft: CampaignDraft, id: string) {
  const entry = campaignStepEntries(draft).find(entry => entry.step.id === id);
  if (!entry) return undefined;
  if (entry.split && entry.path) return entry.split[entry.path].length <= 2 ? "Each path needs a wait and a message" : undefined;
  if (draft.steps.length <= 1) return "Keep at least one message in the sequence";
  if (draft.splits?.some(split => split.afterStepId === id)) return "Remove this message's split before deleting the message";
  return undefined;
}

export function CampaignSequenceEditor({ draft: editableDraft, selectedStepId, onChange, onSelect, history, runs = [] }: {
  history?: CampaignHistoryControls; runs?: CampaignRun[];
  draft: CampaignDraft; selectedStepId: string | null;
  onChange: (draft: CampaignDraft) => void; onSelect: (id: string | null) => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", escape);
    };
  }, [fullscreen]);
  const [runId, setRunId] = useState("");
  const activeRun = runs.find(run => run.id === runId);
  const readOnly = Boolean(activeRun);
  const draft = activeRun?.definition || editableDraft;
  const statuses = activeRun ? campaignRunStatuses(activeRun) : new Map<string, string>();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<CampaignClipboard | null>(null);
  const [feedback, setFeedback] = useState("");
  const instance = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const [moving, setMoving] = useState<{ id: string; x?: number; y: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<Record<string, { width: number; height: number }>>({});
  const entries = campaignStepEntries(draft);
  const selectedEntry = entries.find(entry => entry.step.id === selectedStepId);
  const selectedStep = selectedEntry?.step;
  const selectedSplit = draft.splits?.find(split => split.id === selectedStepId);
  const selectedExists = Boolean(selectedEntry || selectedSplit);
  const firstStepId = draft.steps[0]?.id || null;
  useEffect(() => {
    if (selectedStepId && !selectedExists) onSelect(firstStepId);
  }, [selectedStepId, selectedExists, firstStepId, onSelect]);
  const canAddSplit = entries.length <= 21 && (draft.splits?.length || 0) < 6 && draft.steps.some(step => step.kind !== "wait" && !draft.splits?.some(split => split.afterStepId === step.id));
  const validation = campaignDefinition.safeParse({ ...draft, schemaVersion: 1 });
  const issue = validation.success ? null : validation.error.issues[0]?.message || "Complete the sequence before saving.";

  function removeNode(id: string) {
    if (readOnly || removalReason(draft, id)) return;
    const split = draft.splits?.find(split => split.id === id);
    if (split) {
      onChange({ ...draft, splits: draft.splits?.filter(item => item.id !== id) });
      if (selectedStepId === id || [...split.pathA, ...split.pathB].some(step => step.id === selectedStepId)) onSelect(split.afterStepId);
      return;
    }
    const entry = campaignStepEntries(draft).find(entry => entry.step.id === id);
    if (!entry) return;
    const chain = entry.split && entry.path ? entry.split[entry.path] : draft.steps;
    const steps = chain.filter(step => step.id !== id);
    onChange(entry.split && entry.path ? { ...draft, splits: draft.splits?.map(split => split.id === entry.split!.id ? { ...split, [entry.path!]: steps } : split) } : { ...draft, steps });
    if (selectedStepId === id) onSelect(steps[Math.max(0, chain.findIndex(step => step.id === id) - 1)]?.id || null);
  }

  const graph: { nodes: Node[]; edges: Edge[] } = (() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const style = (id: string) => ({ borderRadius: 12, border: id === selectedStepId ? "2px solid var(--accent)" : "1px solid var(--border)", background: "var(--panel)", color: "var(--foreground)", padding: 10, width: nodeWidth, cursor: "grab" });
    const deleteButton = (id: string, title: string, split = false) => {
      const reason = removalReason(draft, id);
      const label = split ? `Delete split ${title} and both paths` : `Delete ${title}`;
      return <button type="button" aria-label={label} title={reason || label} disabled={readOnly || Boolean(reason)} className="nodrag nopan ml-auto flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--error-surface)] hover:text-[var(--status-red)] disabled:cursor-not-allowed disabled:opacity-30" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); removeNode(id); }}><Trash2 size={14} /></button>;
    };
    const addStep = (step: CampaignStep, x: number, y: number) => {
      const Icon = stepIcons[step.kind];
      nodes.push({ id: step.id, position: { x, y: moving?.id === step.id ? moving.y : y }, data: { label: <span className="flex items-center gap-2 text-left"><span className="rounded-md bg-[var(--accent-soft)] p-1"><Icon size={15} /></span><span className="min-w-0 flex-1"><span className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{stepLabels[step.kind]}</span><span className="block truncate font-medium">{step.title}</span>{statuses.has(step.id) && <span className="mt-1 block text-[10px] text-[var(--muted)]">{statuses.get(step.id)}</span>}</span>{!readOnly && deleteButton(step.id, step.title)}</span> }, draggable: !readOnly, style: style(step.id) });
    };
    const link = (source: string, target: string, label?: string) => {
      const sourceStep = entries.find(entry => entry.step.id === source)?.step;
      const targetStep = entries.find(entry => entry.step.id === target)?.step;
      edges.push({ id: `${source}-${target}`, source, target, type: "campaign", reconnectable: !readOnly && sourceStep && sourceStep.kind !== "wait" && (targetStep?.kind === "wait" || draft.splits?.some(split => split.id === target)) ? "target" : false,
        data: { label, canInsert: entries.length <= 23, ...(!readOnly ? { onInsert: (kind: Exclude<StepKind, "wait">) => {
          try { const next = insertCampaignMessage(draft, source, target, newStep(kind)); onChange(next.draft); onSelect(next.selectedId); setFeedback(""); }
          catch (error) { setFeedback(error instanceof Error ? error.message : "Could not insert message"); }
        }, ...(sourceStep && sourceStep.kind !== "wait" && !entries.find(entry => entry.step.id === source)?.split && !draft.splits?.some(split => split.afterStepId === source) && canAddSplit ? { onSplit: () => addSplit(source) } : {}) } : {}) },
      });
    };
    nodes.push({ id: "start", position: { x: mainX, y: 0 }, data: { label: <span>Contact subscribes{readOnly && <span className="block text-[10px] text-[var(--muted)]">Subscribed</span>}</span> }, draggable: false, selectable: false, style: style("start") });
    let previous = ["start"];
    let y = firstNodeY;
    for (const step of draft.steps) {
      addStep(step, mainX, y);
      previous.forEach(id => link(id, step.id));
      previous = [step.id];
      y += nodeGap;
      const split = draft.splits?.find(split => split.afterStepId === step.id);
      if (split) {
        nodes.push({ id: split.id, position: { x: moving?.id === split.id ? moving.x ?? mainX : mainX, y: moving?.id === split.id ? moving.y : y }, draggable: !readOnly, data: { label: <span className="flex items-center gap-2 text-left"><GitFork size={18} className="shrink-0" /><span className="min-w-0 flex-1"><span className="block text-[10px] uppercase text-[var(--muted)]">A/B split · {split.percentage}/{100 - split.percentage}</span><span className="block truncate font-medium">{split.title}</span>{statuses.has(split.id) && <span className="block text-[10px] text-[var(--muted)]">{statuses.get(split.id)}</span>}</span><button type="button" className="nodrag nopan flex size-6 shrink-0 items-center justify-center rounded hover:bg-[var(--panel-raised)]" aria-label={`${collapsed.includes(split.id) ? "Expand" : "Collapse"} ${split.title}`} onClick={event => { event.stopPropagation(); setCollapsed(ids => ids.includes(split.id) ? ids.filter(id => id !== split.id) : [...ids, split.id]); }}>{collapsed.includes(split.id) ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button>{!readOnly && deleteButton(split.id, split.title, true)}</span> }, style: style(split.id) });
        link(step.id, split.id);
        if (collapsed.includes(split.id)) {
          previous = [split.id];
          y += nodeGap;
          continue;
        }
        y += nodeGap;
        previous = [];
        (["pathA", "pathB"] as const).forEach((path, pathIndex) => {
          let from = split.id;
          split[path].forEach((branchStep, index) => {
            addStep(branchStep, pathIndex === 0 ? 80 : 440, y + index * nodeGap);
            link(from, branchStep.id, index === 0 ? `Path ${pathIndex === 0 ? "A" : "B"} · ${pathIndex === 0 ? split.percentage : 100 - split.percentage}%` : undefined);
            from = branchStep.id;
          });
          previous.push(from);
        });
        y += Math.max(split.pathA.length, split.pathB.length) * nodeGap;
      }
    }
    nodes.push({ id: "end", position: { x: mainX, y }, data: { label: <span>Complete · or stop on reply{readOnly && <span className="block text-[10px] text-[var(--muted)]">{statuses.get("end")}</span>}</span> }, draggable: false, selectable: false, style: style("end") });
    previous.forEach(id => link(id, "end"));
    return { nodes: nodes.map(node => ({ ...node, measured: dimensions[node.id] })), edges };
  })();

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const nodes = instance.current?.getNodes() || [];
      const index = Math.max(0, nodes.findIndex(node => node.id === selectedStepId) - 1);
      void instance.current?.fitView({ nodes: nodes.slice(index, index + 5), padding: 0.2, maxZoom: 1, duration: 200 });
    });
    return () => cancelAnimationFrame(frame);
  }, [draft.splits?.length, collapsed, runId, selectedStepId]);

  function updateChain(steps: CampaignStep[], split?: CampaignSplit, path?: "pathA" | "pathB") {
    if (readOnly) return;
    onChange(split && path ? { ...draft, splits: draft.splits?.map(item => item.id === split.id ? { ...item, [path]: steps } : item) } : { ...draft, steps });
  }
  function insert(kind: StepKind, afterId: string | null = selectedStepId) {
    if (readOnly || entries.length >= 25) return;
    const entry = entries.find(entry => entry.step.id === afterId);
    const split = draft.splits?.find(split => split.id === afterId);
    const path = entry?.path || (split ? "pathA" : undefined);
    const owner = entry?.split || split;
    const chain = owner && path ? owner[path] : draft.steps;
    const steps = [...chain];
    const index = entry ? chain.findIndex(step => step.id === entry.step.id) + 1 : chain.length;
    const step = newStep(kind);
    steps.splice(index, 0, step);
    updateChain(steps, owner, path);
    onSelect(step.id); setDropTarget(null);
  }
  function updateStep(next: CampaignStep) {
    const chain = selectedEntry?.split && selectedEntry.path ? selectedEntry.split[selectedEntry.path] : draft.steps;
    updateChain(chain.map(step => step.id === next.id ? next : step), selectedEntry?.split, selectedEntry?.path);
  }
  function updateSplit(next: CampaignSplit) {
    if (readOnly) return;
    onChange({ ...draft, splits: draft.splits?.map(split => split.id === next.id ? next : split) });
  }
  function addSplit(afterId: string | null = selectedStepId) {
    const anchor = draft.steps.find(step => step.id === afterId);
    if (readOnly || !anchor || anchor.kind === "wait" || !canAddSplit || draft.splits?.some(split => split.afterStepId === anchor.id)) return;
    const path = (name: string) => [newStep("wait"), { ...newStep("email"), title: `Path ${name} follow-up` }];
    const split: CampaignSplit = { id: crypto.randomUUID(), title: "Split paths", afterStepId: anchor.id, percentage: 50, pathA: path("A"), pathB: path("B") };
    onChange({ ...draft, splits: [...(draft.splits || []), split] });
    onSelect(split.id);
  }
  function targetAt(clientX: number, clientY: number) {
    const point = instance.current?.screenToFlowPosition({ x: clientX, y: clientY });
    if (!point) return selectedStepId;
    const candidates = graph.nodes.filter(node => entries.some(entry => entry.step.id === node.id));
    return candidates.reduce<Node | undefined>((nearest, node) => {
      const distance = (item: Node) => Math.abs(item.position.y - point.y) + Math.abs(item.position.x + nodeWidth / 2 - point.x);
      return !nearest || distance(node) < distance(nearest) ? node : nearest;
    }, undefined)?.id || null;
  }
  function splitAnchorAt(point: { x: number; y: number }, movingSplitId?: string) {
    const candidates = graph.nodes.filter(node => draft.steps.some(step => step.id === node.id && step.kind !== "wait") && !draft.splits?.some(split => split.id !== movingSplitId && split.afterStepId === node.id));
    return candidates.reduce<Node | undefined>((nearest, node) => {
      const distance = (item: Node) => Math.abs(item.position.y + nodeGap - point.y) + Math.abs(item.position.x - point.x);
      return !nearest || distance(node) < distance(nearest) ? node : nearest;
    }, undefined)?.id || null;
  }
  function splitDropTarget(clientX: number, clientY: number) {
    const point = instance.current?.screenToFlowPosition({ x: clientX, y: clientY });
    return point ? splitAnchorAt(point) : selectedStepId;
  }
  function onPaletteDragStart(event: DragEvent<HTMLButtonElement>, kind: StepKind | "split") {
    if (kind === "split") event.dataTransfer.setData("application/x-acquire-campaign-split", "split");
    event.dataTransfer.setData("application/x-acquire-campaign-step", kind); event.dataTransfer.effectAllowed = "copy";
  }
  function onCanvasDrop(event: DragEvent<HTMLDivElement>) {
    if (readOnly) return;
    const kind = event.dataTransfer.getData("application/x-acquire-campaign-step");
    if (kind === "split") { event.preventDefault(); addSplit(splitDropTarget(event.clientX, event.clientY)); setDropTarget(null); return; }
    if (kind !== "email" && kind !== "wait" && kind !== "whatsapp" && kind !== "linkedin") return;
    event.preventDefault(); insert(kind, targetAt(event.clientX, event.clientY));
  }

  function duplicateNode(id = selectedStepId) {
    if (readOnly || !id) return;
    const copied = copyCampaignNode(draft, id);
    if (!copied) { setFeedback("Select a message or a split to duplicate"); return; }
    applyPaste(copied, id);
  }
  function applyPaste(copied: CampaignClipboard, afterId = selectedStepId) {
    try { const next = pasteCampaignNode(draft, copied, afterId); onChange(next.draft); onSelect(next.selectedId); setFeedback(""); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Could not paste"); }
  }
  async function copyPath(split: CampaignSplit, path: "pathA" | "pathB") {
    const copied: CampaignClipboard = { kind: "path", steps: structuredClone(split[path]) };
    setClipboard(copied);
    try { await navigator.clipboard.writeText(JSON.stringify({ acquireSequenceClipboard: 1, ...copied })); } catch { /* Use internal clipboard if clipboard access is unavailable. */ }
    setFeedback(`Path ${path === "pathA" ? "A" : "B"} copied. Select a node in the destination path and paste.`);
  }
  function duplicatePath(split: CampaignSplit, path: "pathA" | "pathB") {
    if (readOnly) return;
    const target = path === "pathA" ? "pathB" : "pathA";
    applyPaste({ kind: "path", steps: split[path] }, split[target].at(-1)!.id);
  }
  async function copyNode() {
    if (!selectedStepId) return;
    const copied = copyCampaignNode(draft, selectedStepId);
    if (!copied) { setFeedback("Select a message or split to copy"); return; }
    setClipboard(copied);
    try { await navigator.clipboard.writeText(JSON.stringify({ acquireSequenceClipboard: 1, ...copied })); } catch { /* Internal clipboard works when browser clipboard access is unavailable. */ }
    setFeedback("Copied. Select a destination node and paste.");
  }
  async function pasteNode() {
    if (readOnly) return;
    let copied = clipboard;
    try {
      const parsed = parseCampaignClipboard(JSON.parse(await navigator.clipboard.readText()));
      if (parsed) copied = parsed;
    } catch { /* Fall back to the editor clipboard. */ }
    if (copied) applyPaste(copied); else setFeedback("Copy a message or split before pasting");
  }
  function connect(source: string | null, target: string | null) {
    if (readOnly || !source || !target) return;
    const next = reconnectCampaign(draft, source, target);
    if (next) { onChange(next); setFeedback("Connection updated"); }
    else setFeedback("Connect a message to a wait to move its message pair, or to a split to move its branches. Paths must remain valid.");
  }

  return <div className={`grid bg-[var(--panel)] lg:grid-cols-[minmax(0,1fr)_320px] ${fullscreen ? "fixed inset-0 z-[100] h-dvh w-full overflow-auto lg:overflow-hidden" : ""}`} tabIndex={0} aria-label="Sequence flow editor" onKeyDown={event => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true']") || !(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === "z" && !readOnly) { event.preventDefault(); if (event.shiftKey) history?.redo(); else history?.undo(); }
    else if (key === "y" && !readOnly) { event.preventDefault(); history?.redo(); }
    else if (key === "c") { event.preventDefault(); void copyNode(); }
    else if (key === "v" && !readOnly) { event.preventDefault(); void pasteNode(); }
    else if (key === "d" && !readOnly) { event.preventDefault(); duplicateNode(); }
  }}>
    <div className={`min-w-0 border-b border-[var(--border)] lg:border-b-0 ${fullscreen ? "flex min-h-0 flex-col" : ""}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] p-3" aria-label="Flow actions">
        <button type="button" className={button} disabled={readOnly || !history?.canUndo} onClick={() => history?.undo()} title="Undo (Ctrl/Cmd+Z)"><Undo2 size={15} /> Undo</button>
        <button type="button" className={button} disabled={readOnly || !history?.canRedo} onClick={() => history?.redo()} title="Redo (Ctrl/Cmd+Shift+Z)"><Redo2 size={15} /> Redo</button>
        <button type="button" className={button} disabled={readOnly || !selectedStepId} onClick={() => duplicateNode()} title="Duplicate (Ctrl/Cmd+D)"><Copy size={15} /> Duplicate</button>
        <button type="button" className={button} disabled={!selectedStepId} onClick={() => { void copyNode(); }} title="Copy (Ctrl/Cmd+C)"><Copy size={15} /> Copy</button>
        <button type="button" className={button} disabled={readOnly} onClick={() => { void pasteNode(); }} title="Paste (Ctrl/Cmd+V)"><ClipboardPaste size={15} /> Paste</button>
        <label className="ml-auto flex items-center gap-2 text-xs">Live status<select className="max-w-52 rounded-lg border border-[var(--border)] bg-[var(--background)] p-2" value={activeRun?.id || ""} onChange={event => { setRunId(event.target.value); onSelect(null); }}><option value="">Edit draft</option>{runs.map(run => <option key={run.id} value={run.id}>{run.label} · v{run.version} · {run.state}</option>)}</select></label>
        <button type="button" className={button} aria-pressed={fullscreen} onClick={() => setFullscreen(value => !value)} title={fullscreen ? "Exit fullscreen (Esc)" : "Open editor fullscreen"}>{fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{fullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
      </div>
      {activeRun && <p role="status" className="border-b border-[var(--border)] bg-[var(--accent-soft)] px-3 py-2 text-xs">Live published version {activeRun.version} · {activeRun.label}. Refreshes every 15 seconds. Select Edit draft to make changes.{activeRun.stopReason && ` Reason: ${activeRun.stopReason.replaceAll("_", " ")}.`}</p>}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] p-3">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Add a node</span>
        {(["email", "wait", "whatsapp", "linkedin"] as const).map(kind => {
          const Icon = stepIcons[kind];
          return <button key={kind} type="button" draggable disabled={readOnly || entries.length >= 25} onDragStart={event => onPaletteDragStart(event, kind)} onClick={() => insert(kind)} className={button}><Icon size={16} /> {stepLabels[kind]} <Plus size={14} /></button>;
        })}
        <button type="button" draggable disabled={readOnly || !canAddSplit} onDragStart={event => onPaletteDragStart(event, "split")} onClick={() => addSplit()} className={button} title="Drag onto the main sequence, or select a main message and click to add an A/B split"><GitFork size={16} /> Split paths <Plus size={14} /></button>
        <span className="text-xs text-[var(--muted)]">Drag into the flow, or add after the selected node. Split paths attach after a main message.</span>
      </div>
      <div className={`relative bg-[var(--background)] ${fullscreen ? "min-h-[400px] flex-1 lg:min-h-0" : "h-[650px]"}`} onDragOver={event => { if (readOnly || !event.dataTransfer.types.includes("application/x-acquire-campaign-step")) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDropTarget(event.dataTransfer.types.includes("application/x-acquire-campaign-split") ? splitDropTarget(event.clientX, event.clientY) : targetAt(event.clientX, event.clientY)); }} onDragLeave={() => setDropTarget(null)} onDrop={onCanvasDrop}>
        <ReactFlow nodes={graph.nodes} edges={graph.edges} edgeTypes={campaignEdgeTypes} deleteKeyCode={null} nodesConnectable={!readOnly} nodesDraggable={!readOnly} edgesReconnectable={!readOnly} isValidConnection={connection => !readOnly && Boolean(reconnectCampaign(draft, connection.source, connection.target))} onConnect={connection => connect(connection.source, connection.target)} onReconnect={(_edge, connection) => connect(connection.source, connection.target)} onNodeContextMenu={(event, node) => { event.preventDefault(); onSelect(node.id); setFeedback("Use Duplicate, Copy or Paste above, or Ctrl/Cmd+D, C and V."); }} onInit={flow => { instance.current = flow; }} onNodesChange={changes => {
          const measured = changes.filter(change => change.type === "dimensions" && change.dimensions);
          if (measured.length) setDimensions(previous => {
            const next = { ...previous };
            let changed = false;
            for (const change of measured) if (change.type === "dimensions" && change.dimensions && (previous[change.id]?.width !== change.dimensions.width || previous[change.id]?.height !== change.dimensions.height)) {
              next[change.id] = change.dimensions;
              changed = true;
            }
            return changed ? next : previous;
          });
          for (const change of changes) if (change.type === "position" && change.position && (entries.some(entry => entry.step.id === change.id) || draft.splits?.some(split => split.id === change.id))) setMoving({ id: change.id, x: change.position.x, y: change.position.y }); }} onNodeDragStop={(_event, node) => {
          if (readOnly) return;
          const split = draft.splits?.find(split => split.id === node.id);
          if (split) {
            const afterStepId = splitAnchorAt(node.position, split.id);
            setMoving(null);
            if (afterStepId && afterStepId !== split.afterStepId) updateSplit({ ...split, afterStepId });
            onSelect(split.id);
            return;
          }
          const entry = entries.find(entry => entry.step.id === node.id);
          if (!entry) return;
          const chain = entry.split && entry.path ? entry.split[entry.path] : draft.steps;
          const from = chain.findIndex(step => step.id === node.id);
          // Only reorder inside the node's own path; moving vertically never
          // silently changes which contacts will receive a message.
          const others = chain.filter(step => step.id !== node.id);
          const to = others.filter(step => (graph.nodes.find(item => item.id === step.id)?.position.y || 0) < node.position.y).length;
          const steps = [...chain]; steps.splice(to, 0, steps.splice(from, 1)[0]);
          setMoving(null); updateChain(steps, entry.split, entry.path); onSelect(node.id);
        }} onNodeClick={(_event, node) => { if (entries.some(entry => entry.step.id === node.id) || draft.splits?.some(split => split.id === node.id)) onSelect(node.id); }} minZoom={0.15} fitView fitViewOptions={{ padding: 0.2, nodes: graph.nodes.slice(0, 5), maxZoom: 1 }} elementsSelectable><Background color="var(--border)" /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={node => statuses.get(node.id) === "Sent" ? "#16a34a" : statuses.get(node.id) === "Stopped" || statuses.get(node.id) === "Needs review" ? "#dc2626" : "#94a3b8"} style={{ background: "var(--panel)", width: 140, height: 100 }} /></ReactFlow>
        {dropTarget && <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg border border-[var(--accent)] bg-[var(--panel)] px-3 py-2 text-xs font-medium shadow-lg">Add after {entries.find(entry => entry.step.id === dropTarget)?.step.title}</div>}
      </div>
    </div>
    <div className={`space-y-4 p-5 lg:border-l lg:border-[var(--border)] ${fullscreen ? "min-h-0 overflow-y-auto" : ""}`}>
      <h3 className="text-sm font-semibold">{selectedSplit ? "Split path settings" : selectedStep ? `${stepLabels[selectedStep.kind]} settings` : "Step settings"}</h3>
      <fieldset disabled={readOnly} className="space-y-4">
      {selectedSplit ? <>
        <label className="block text-xs font-medium">Name<input value={selectedSplit.title} onChange={event => updateSplit({ ...selectedSplit, title: event.target.value })} className={field} /></label>
        <label className="block text-xs font-medium">Path A allocation (%)<input type="number" min={1} max={99} value={selectedSplit.percentage} onChange={event => updateSplit({ ...selectedSplit, percentage: Number(event.target.value) })} className={field} /></label>
        <p className="text-xs text-[var(--muted)]">Path A: {selectedSplit.percentage}% · Path B: {100 - selectedSplit.percentage}%. Each contact follows one stable path. Both paths rejoin the main sequence.</p>
        {(["pathA", "pathB"] as const).map((path, index) => <button key={path} type="button" className={`${button} w-full`} onClick={() => onSelect(selectedSplit[path].at(-1)?.id || null)}>Edit path {index === 0 ? "A" : "B"}</button>)}
        {(["pathA", "pathB"] as const).map(path => <div key={`copy-${path}`} className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => { void copyPath(selectedSplit, path); }}>Copy path {path === "pathA" ? "A" : "B"}</button><button type="button" className={button} onClick={() => duplicatePath(selectedSplit, path)}>Duplicate {path === "pathA" ? "A to B" : "B to A"}</button></div>)}
        <p className="text-xs text-[var(--muted)]">Select a node in either path to edit it or add more nodes to that path. Each path starts with a wait and ends with a message.</p>
        <button type="button" className={`${button} w-full`} onClick={() => removeNode(selectedSplit.id)}><Trash2 size={15} /> Remove split and both paths</button>
      </> : selectedStep ? <>
        {selectedEntry?.split && <p className="text-xs font-semibold text-[var(--muted)]">{selectedEntry.split.title} · Path {selectedEntry.path === "pathA" ? "A" : "B"}</p>}
        <label className="block text-xs font-medium">Name<input value={selectedStep.title} onChange={event => updateStep({ ...selectedStep, title: event.target.value })} className={field} /></label>
        {selectedStep.kind !== "wait" ? <>
          {selectedStep.kind === "email" && <label className="block text-xs font-medium">Subject<input value={selectedStep.subject} onChange={event => updateStep({ ...selectedStep, subject: event.target.value })} className={field} /></label>}
          <label className="block text-xs font-medium">Body<textarea value={selectedStep.body} onChange={event => updateStep({ ...selectedStep, body: event.target.value })} rows={10} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-sm" /></label>
          <p className="text-xs text-[var(--muted)]">Use {"{{first_name}}"}, {"{{full_name}}"}, or {"{{company_name}}"}.</p>
        </> : <label className="block text-xs font-medium">Days to wait<input type="number" min={1} max={30} value={selectedStep.days} onChange={event => updateStep({ ...selectedStep, days: Number(event.target.value) })} className={field} /></label>}
        <button type="button" disabled={Boolean(removalReason(draft, selectedStep.id))} title={removalReason(draft, selectedStep.id)} onClick={() => removeNode(selectedStep.id)} className={`${button} w-full`}><Trash2 size={15} /> Remove this node</button>
      </> : <p className="text-xs text-[var(--muted)]">Select a node to edit it.</p>}
      </fieldset>
      {feedback && <p role="status" className="rounded-lg border border-[var(--border)] p-3 text-xs">{feedback}</p>}
      {!readOnly && <p className="text-xs text-[var(--muted)]">Use + on a connection to insert a message with its wait. Reconnect a message to a wait to move that pair, or to a split to relocate both branches.</p>}
      {issue && <p role="status" className="rounded-lg border border-[var(--border)] bg-[var(--accent-soft)] p-3 text-xs">To save or publish: {issue}. Use a wait between messages; split paths start with a wait.</p>}
      {entries.some(({ step }) => step.kind === "linkedin" || step.kind === "whatsapp") && <p className="text-xs text-[var(--muted)]">WhatsApp and LinkedIn nodes are saved for manual use. Publishing these sequences requires channel delivery support.</p>}
      <p className="text-xs text-[var(--muted)]">Drag a node vertically to reorder it within its path. Drag a split below another main message to move both branches. Changes are saved as a draft until you publish.</p>
    </div>
  </div>;
}
