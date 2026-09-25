"use client";

import "@xyflow/react/dist/style.css";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { Background, Controls, ReactFlow, type Edge, type Node, type ReactFlowInstance } from "@xyflow/react";
import { Clock3, Mail, Plus, Trash2 } from "lucide-react";
import { campaignDefinition, type CampaignStep } from "@/domain/campaign";

type Draft = { steps: CampaignStep[]; schemaVersion?: 1 };
type StepKind = CampaignStep["kind"];

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 text-sm font-medium hover:bg-[var(--panel-raised)] disabled:cursor-not-allowed disabled:opacity-40";
const nodeWidth = 230;
const nodeGap = 120;
const firstNodeY = 110;

function newStep(kind: StepKind): CampaignStep {
  return kind === "wait"
    ? { id: crypto.randomUUID(), kind, title: "Wait three days", days: 3 }
    : { id: crypto.randomUUID(), kind, title: "Follow-up", subject: "Following up with {{company_name}}", body: "Hi {{first_name}},\n\nJust following up on my note.\n\nBest regards" };
}

export function CampaignSequenceEditor({ draft, selectedStepId, onChange, onSelect }: {
  draft: Draft;
  selectedStepId: string | null;
  onChange: (draft: Draft) => void;
  onSelect: (id: string | null) => void;
}) {
  const instance = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const [moving, setMoving] = useState<{ id: string; y: number } | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const selectedStep = draft.steps.find(step => step.id === selectedStepId);
  const validation = campaignDefinition.safeParse({ ...draft, schemaVersion: 1 });
  const issue = validation.success ? null : validation.error.issues[0]?.message || "Complete the sequence before saving.";

  const graph = useMemo(() => {
    const stepNodes: Node[] = draft.steps.map((step, index) => ({
      id: step.id,
      position: { x: 80, y: moving?.id === step.id ? moving.y : firstNodeY + index * nodeGap },
      data: { label: <span className="flex items-center gap-2 text-left"><span className="rounded-md bg-[var(--accent-soft)] p-1">{step.kind === "email" ? <Mail size={15} /> : <Clock3 size={15} />}</span><span><span className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{step.kind}</span><span className="block truncate font-medium">{step.title}</span></span></span> },
      style: { borderRadius: 12, border: step.id === selectedStepId ? "2px solid var(--accent)" : "1px solid var(--border)", background: "var(--panel)", color: "var(--foreground)", padding: 10, width: nodeWidth, cursor: "grab" },
    }));
    const nodes: Node[] = [
      { id: "start", position: { x: 80, y: 0 }, data: { label: "Contact subscribes" }, draggable: false, selectable: false, style: { borderRadius: 12, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--foreground)", padding: 12, width: nodeWidth, textAlign: "center" } },
      ...stepNodes,
      { id: "end", position: { x: 80, y: firstNodeY + draft.steps.length * nodeGap }, data: { label: "Complete · or stop on reply" }, draggable: false, selectable: false, style: { borderRadius: 12, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--foreground)", padding: 12, width: nodeWidth, textAlign: "center" } },
    ];
    const edges: Edge[] = nodes.slice(1).map((node, index) => ({ id: `edge-${index}`, source: nodes[index].id, target: node.id, animated: index === 0 }));
    return { nodes, edges };
  }, [draft.steps, moving, selectedStepId]);

  function insert(kind: StepKind, index: number) {
    if (draft.steps.length >= 25) return;
    const step = newStep(kind);
    const steps = [...draft.steps];
    steps.splice(Math.max(0, Math.min(index, steps.length)), 0, step);
    onChange({ ...draft, steps });
    onSelect(step.id);
    setDropIndex(null);
  }

  function updateStep(next: CampaignStep) {
    onChange({ ...draft, steps: draft.steps.map(step => step.id === next.id ? next : step) });
  }

  function insertionIndex(clientY: number) {
    const y = instance.current?.screenToFlowPosition({ x: 0, y: clientY }).y ?? 0;
    return Math.max(0, Math.min(draft.steps.length, Math.round((y - firstNodeY + nodeGap / 2) / nodeGap)));
  }

  function onPaletteDragStart(event: DragEvent<HTMLButtonElement>, kind: StepKind) {
    event.dataTransfer.setData("application/x-acquire-campaign-step", kind);
    event.dataTransfer.effectAllowed = "copy";
  }

  function onCanvasDragOver(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("application/x-acquire-campaign-step")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropIndex(insertionIndex(event.clientY));
  }

  function onCanvasDrop(event: DragEvent<HTMLDivElement>) {
    const kind = event.dataTransfer.getData("application/x-acquire-campaign-step");
    if (kind !== "email" && kind !== "wait") return;
    event.preventDefault();
    insert(kind, insertionIndex(event.clientY));
  }

  return <div className="grid lg:grid-cols-[minmax(0,1fr)_320px]">
    <div className="min-w-0 border-b border-[var(--border)] lg:border-b-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] p-3">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Add a node</span>
        <button type="button" draggable disabled={draft.steps.length >= 25} onDragStart={event => onPaletteDragStart(event, "email")} onClick={() => insert("email", selectedStep ? draft.steps.indexOf(selectedStep) + 1 : draft.steps.length)} className={button}><Mail size={16} /> Email <Plus size={14} /></button>
        <button type="button" draggable disabled={draft.steps.length >= 25} onDragStart={event => onPaletteDragStart(event, "wait")} onClick={() => insert("wait", selectedStep ? draft.steps.indexOf(selectedStep) + 1 : draft.steps.length)} className={button}><Clock3 size={16} /> Wait <Plus size={14} /></button>
        <span className="text-xs text-[var(--muted)]">Drag into the flow, or click to add after the selected node.</span>
      </div>
      <div className="relative h-[650px] bg-[var(--background)]" onDragOver={onCanvasDragOver} onDragLeave={() => setDropIndex(null)} onDrop={onCanvasDrop}>
        <ReactFlow nodes={graph.nodes} edges={graph.edges} onInit={flow => { instance.current = flow; }} onNodesChange={changes => { for (const change of changes) if (change.type === "position" && change.position && draft.steps.some(step => step.id === change.id)) setMoving({ id: change.id, y: change.position.y }); }} onNodeDragStop={(_event, node) => { const from = draft.steps.findIndex(step => step.id === node.id); if (from < 0) return; const to = Math.max(0, Math.min(draft.steps.length - 1, Math.round((node.position.y - firstNodeY) / nodeGap))); const steps = [...draft.steps]; steps.splice(to, 0, steps.splice(from, 1)[0]); setMoving(null); onChange({ ...draft, steps }); onSelect(node.id); }} onNodeClick={(_event, node) => { if (draft.steps.some(step => step.id === node.id)) onSelect(node.id); }} fitView fitViewOptions={{ padding: 0.15 }} nodesConnectable={false} elementsSelectable nodesDraggable><Background color="var(--border)" /><Controls showInteractive={false} /></ReactFlow>
        {dropIndex !== null && <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg border border-[var(--accent)] bg-[var(--panel)] px-3 py-2 text-xs font-medium shadow-lg">Drop at position {dropIndex + 1}</div>}
      </div>
    </div>
    <div className="space-y-4 p-5 lg:border-l lg:border-[var(--border)]">
      <h3 className="text-sm font-semibold">{selectedStep ? `${selectedStep.kind === "email" ? "Email" : "Wait"} settings` : "Step settings"}</h3>
      {selectedStep ? <>
        <label className="block text-xs font-medium">Name<input value={selectedStep.title} onChange={event => updateStep({ ...selectedStep, title: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm" /></label>
        {selectedStep.kind === "email" ? <>
          <label className="block text-xs font-medium">Subject<input value={selectedStep.subject} onChange={event => updateStep({ ...selectedStep, subject: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm" /></label>
          <label className="block text-xs font-medium">Body<textarea value={selectedStep.body} onChange={event => updateStep({ ...selectedStep, body: event.target.value })} rows={10} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-sm" /></label>
          <p className="text-xs text-[var(--muted)]">Use {"{{first_name}}"}, {"{{full_name}}"}, or {"{{company_name}}"}.</p>
        </> : <label className="block text-xs font-medium">Days to wait<input type="number" min={1} max={30} value={selectedStep.days} onChange={event => updateStep({ ...selectedStep, days: Number(event.target.value) })} className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm" /></label>}
        <button type="button" disabled={draft.steps.length <= 1} onClick={() => { const steps = draft.steps.filter(step => step.id !== selectedStep.id); onChange({ ...draft, steps }); onSelect(steps[Math.max(0, draft.steps.indexOf(selectedStep) - 1)]?.id || null); }} className={`${button} w-full`}><Trash2 size={15} /> Remove this node</button>
      </> : <p className="text-xs text-[var(--muted)]">Select an email or wait node to edit it.</p>}
      {issue && <p role="status" className="rounded-lg border border-[var(--border)] bg-[var(--accent-soft)] p-3 text-xs">To save or publish: {issue}. Each sequence starts and ends with an email, with a wait between emails.</p>}
      <p className="text-xs text-[var(--muted)]">Drag a node vertically to change its order. Changes are saved as a draft until you publish.</p>
    </div>
  </div>;
}
