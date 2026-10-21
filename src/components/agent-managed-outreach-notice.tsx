'use client';

import Link from 'next/link';
import { Info } from 'lucide-react';
import { DetailTooltip } from './detail-tooltip';
import { agentManagedOutreachReason } from '@/domain/mandate-outreach-owner';

export function AgentManagedOutreachNotice({ mandateId }: { mandateId: string }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 text-sm">
    <p>The agent manages outreach for this mandate.</p>
    <DetailTooltip content={agentManagedOutreachReason}>
      <span className="inline-flex min-h-10 items-center gap-1 text-[var(--muted)]"><Info size={16} /><span className="sr-only">Why are sequence subscriptions unavailable?</span></span>
    </DetailTooltip>
    <Link href={`/mandates/${encodeURIComponent(mandateId)}/agent`} className="ml-auto inline-flex min-h-10 items-center underline underline-offset-4">View agent</Link>
  </div>;
}
