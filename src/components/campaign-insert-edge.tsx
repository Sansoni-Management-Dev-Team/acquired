"use client";
import { useEffect, useRef, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useViewport, type Edge, type EdgeProps } from "@xyflow/react";
import { Plus, Trash2 } from "lucide-react";
import type { CampaignStep } from "@/domain/campaign";
export type CampaignInsertData = {
  onInsert?: (kind: Exclude<CampaignStep["kind"], "wait">, action?: "connect" | "message") => void;
  onSplit?: () => void; canInsert: boolean; label?: string;
  onDelete?: () => void;
};
export type CampaignInsertEdge = Edge<CampaignInsertData>;
export function CampaignConnectionEdge(props: EdgeProps<CampaignInsertEdge>) {
  const { zoom } = useViewport();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [open]);
  const [path, x, y] = getBezierPath(props);
  return <>
    <BaseEdge id={props.id} path={path} style={{ ...props.style, ...(props.selected ? { stroke: "var(--accent)", strokeWidth: 2 } : {}) }} markerEnd={props.markerEnd} />
    <EdgeLabelRenderer><div ref={menuRef} className="nodrag nopan absolute flex flex-col items-center gap-1" style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`, pointerEvents: "all", zIndex: open ? 1001 : 1 }}>
      {props.data?.label && <span className="rounded bg-[var(--panel)] px-1 text-[10px] text-[var(--muted)]">{props.data.label}</span>}
      {props.selected && props.data?.onDelete && <button type="button" aria-label="Delete connection" title="Delete connection" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); props.data?.onDelete?.(); }} className="grid size-6 place-items-center rounded-full border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] shadow-sm hover:bg-[var(--error-surface)] hover:text-[var(--status-red)]"><Trash2 size={13} /></button>}
      {props.data?.onInsert && <button type="button" aria-label="Insert a message on this connection" aria-expanded={open} disabled={!props.data.canInsert} onClick={event => { event.stopPropagation(); setOpen(value => !value); }} className="grid size-6 place-items-center rounded-full border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] shadow-sm hover:text-[var(--foreground)] disabled:opacity-30"><Plus size={13} /></button>}
      {open && <div className="absolute top-full z-50 mt-1 min-w-40 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1 shadow-lg" aria-label="Insert message" style={{ transform: `scale(${1 / zoom})`, transformOrigin: "top center" }}>
        {(["email", "whatsapp", "linkedin"] as const).map(kind => <button key={kind} type="button" className="block w-full rounded px-3 py-2 text-left text-xs hover:bg-[var(--panel-raised)]" onClick={event => { event.stopPropagation(); props.data?.onInsert?.(kind); setOpen(false); }}>{kind === "email" ? "Email" : kind === "whatsapp" ? "WhatsApp" : "LinkedIn message"} + wait</button>)}
        <button type="button" className="block w-full rounded px-3 py-2 text-left text-xs hover:bg-[var(--panel-raised)]" onClick={event => { event.stopPropagation(); props.data?.onInsert?.("linkedin", "connect"); setOpen(false); }}>LinkedIn connection request + wait</button>
        {props.data?.onSplit && <button type="button" className="block w-full rounded px-3 py-2 text-left text-xs hover:bg-[var(--panel-raised)]" onClick={event => { event.stopPropagation(); props.data?.onSplit?.(); setOpen(false); }}>A/B split</button>}
        <button type="button" className="block w-full rounded px-3 py-2 text-left text-xs text-[var(--muted)]" onClick={() => setOpen(false)}>Cancel</button>
      </div>}
    </div></EdgeLabelRenderer>
  </>;
}
export const campaignEdgeTypes = { campaign: CampaignConnectionEdge };
