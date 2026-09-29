export default function MandateLoading() {
  return (
    <div className="space-y-5 p-5 sm:p-8" role="status" aria-label="Loading mandate">
      <div className="h-4 w-40 animate-pulse rounded bg-[var(--panel-raised)]" />
      <div className="h-9 w-72 max-w-full animate-pulse rounded bg-[var(--panel-raised)]" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-44 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--panel)]" />
        <div className="h-44 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--panel)]" />
      </div>
      <span className="sr-only">Loading mandate…</span>
    </div>
  );
}
