import type { summariseResearchTimings } from '@/domain/research-timing';

export type PipelineTimings = ReturnType<typeof summariseResearchTimings>;
const seconds = (milliseconds: number) => `${(milliseconds / 1000).toFixed(1)}s`;
export function ResearchTimingPanel({ timing }: { timing?: PipelineTimings }) {
  if (!timing?.spans) return null;
  const rows = Object.entries(timing.segments).sort((a, b) => (b[1]?.totalMs || 0) - (a[1]?.totalMs || 0));
  return <details className="border-t border-[var(--border)] pt-2 text-xs">
    <summary className="min-h-10 cursor-pointer content-center">Pipeline timings · {timing.spans} measured operations</summary>
    <p className="mb-3 text-[var(--muted)]">Measured window: {seconds(timing.measuredWindowMs)}. Work totals include parallel operations; callback timings also include their nested steps and cannot be added to get elapsed time.</p>
    {(timing.timeToFirstCompanyMs !== null || timing.timeToTargetMs !== null) && <p className="mb-3">{timing.timeToFirstCompanyMs !== null && <>First new relevant company: {seconds(timing.timeToFirstCompanyMs)}. </>}{timing.timeToTargetMs !== null && <>Shortlist target reached: {seconds(timing.timeToTargetMs)}.</>}</p>}
    <div className="overflow-x-auto">
      <table className="w-full text-left tabular-nums">
        <thead><tr className="border-b border-[var(--border)]"><th className="py-2 pr-3 font-medium">Segment</th><th className="px-2 font-medium">Calls</th><th className="px-2 font-medium">Work time</th><th className="px-2 font-medium">Mean</th><th className="px-2 font-medium">P95</th><th className="px-2 font-medium">Failed</th></tr></thead>
        <tbody>{rows.map(([segment, stats]) => stats && <tr key={segment} className="border-b border-[var(--border)]"><td className="py-2 pr-3">{segment.replaceAll('_', ' ')}</td><td className="px-2">{stats.calls}</td><td className="px-2">{seconds(stats.totalMs)}</td><td className="px-2">{seconds(stats.meanMs)}</td><td className="px-2">{seconds(stats.p95Ms)}</td><td className="px-2">{stats.failed}</td></tr>)}</tbody>
      </table>
    </div>
    {timing.cappedJobs > 0 && <p className="mt-2 text-[var(--muted)]">{timing.cappedJobs} jobs reached the retained timing limit. Full operation events remain in provider logs.</p>}
  </details>;
}
