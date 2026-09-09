"use client";

import { useState } from "react";

const states = [
  ["ACT", "Australian Capital Territory"], ["NSW", "New South Wales"],
  ["NT", "Northern Territory"], ["QLD", "Queensland"],
  ["SA", "South Australia"], ["TAS", "Tasmania"],
  ["VIC", "Victoria"], ["WA", "Western Australia"],
] as const;

export function GeographySelect({ value, onChange, disabled, className }: {
  value: string; onChange: (value: string) => void; disabled?: boolean; className: string;
}) {
  const [choice, setChoice] = useState("");
  const parts = value.split(/[,;]/).map(part => part.trim()).filter(Boolean);
  const selected = parts.map(part => states.find(([code, name]) => code.toLowerCase() === part.toLowerCase() || name.toLowerCase() === part.toLowerCase())?.[0]);
  const national = /^(national|australia-wide|all australia)$/i.test(value.trim());
  const mode = national ? "National" : parts.length && selected.every(Boolean) ? "states" : value.trim() ? "custom" : choice;
  return <div className="space-y-2">
    <label className="block text-sm">Geography
      <select className={className} disabled={disabled} value={mode} onChange={e => { setChoice(e.target.value); onChange(e.target.value === "National" ? "National" : ""); }}>
        <option value="" disabled>Select geography</option>
        <option value="National">National</option>
        <option value="states">Select states / territories</option>
        <option value="custom">Custom location</option>
      </select>
    </label>
    {mode === "states" && <fieldset disabled={disabled} className="rounded-md border border-[var(--border)] p-3">
      <legend className="px-1 text-xs text-[var(--muted)]">States and territories · select one or more</legend>
      <div className="grid gap-2 sm:grid-cols-2">{states.map(([code, name]) => <label key={code} className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={selected.includes(code)} disabled={selected.length === 1 && selected.includes(code)} onChange={e => onChange(states.filter(([item]) => item === code ? e.target.checked : selected.includes(item)).map(([item]) => item).join(", "))} />{name}
      </label>)}</div>
    </fieldset>}
    {mode === "custom" && <label className="block text-sm">Custom location<input className={className} disabled={disabled} value={value.trimStart()} onChange={e => onChange(e.target.value)} /></label>}
  </div>;
}
