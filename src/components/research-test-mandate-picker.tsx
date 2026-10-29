'use client';

import {ChevronLeft, ChevronRight} from 'lucide-react';
import {researchTestMandates, type ResearchTestMandate} from '@/data/research-test-mandates';

type Props = {
  value: string;
  disabled?: boolean;
  onSelect: (sample: ResearchTestMandate | null) => void;
};

export function ResearchTestMandatePicker({value, disabled = false, onSelect}: Props) {
  const index = researchTestMandates.findIndex(sample => sample.id === value);
  const selected = researchTestMandates[index];
  const navigation = 'inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-35 sm:size-11 sm:shrink-0';

  return (
    <div className="min-w-0 border-t border-[var(--border)] pt-4">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <label htmlFor="research-test-mandate" className="font-medium text-[var(--foreground)]">Sample mandate</label>
        <span aria-live="polite" className="tabular-nums text-[var(--muted)]">{selected ? `${index + 1} of ${researchTestMandates.length}` : `${researchTestMandates.length} examples`}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <select
          id="research-test-mandate"
          value={value}
          disabled={disabled}
          onChange={event => onSelect(researchTestMandates.find(sample => sample.id === event.target.value) ?? null)}
          className="col-span-2 min-h-11 w-full min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 text-sm text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-50 sm:w-0"
        >
          <option value="">Use your own brief</option>
          {researchTestMandates.map((sample, position) => <option key={sample.id} value={sample.id}>{String(position + 1).padStart(2, '0')} · {sample.name} · {sample.states.join(', ')}</option>)}
        </select>
        <button type="button" aria-label="Previous sample mandate" disabled={disabled || index <= 0} onClick={() => onSelect(researchTestMandates[index - 1])} className={navigation}><ChevronLeft size={16} aria-hidden="true" /><span className="text-xs sm:hidden">Previous</span></button>
        <button type="button" aria-label="Next sample mandate" disabled={disabled || index === researchTestMandates.length - 1} onClick={() => onSelect(researchTestMandates[index + 1])} className={navigation}><span className="text-xs sm:hidden">Next</span><ChevronRight size={16} aria-hidden="true" /></button>
      </div>
      {selected && <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">{selected.states.join(', ')} · AUD {selected.revenue} revenue · {selected.employees} people</p>}
      <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">Fills the brief above. Review it, then run the test.</p>
    </div>
  );
}
