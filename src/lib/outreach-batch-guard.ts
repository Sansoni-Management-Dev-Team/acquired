type Lease = { startedAt: number; active: boolean };
const runtime = globalThis as typeof globalThis & { outreachBatchLeases?: Map<string, Lease> };
const leases = runtime.outreachBatchLeases ??= new Map<string, Lease>();

// Protect each warm server instance from overlapping batches. Persistence remains
// idempotent across instances through sequence and message uniqueness constraints.
export function acquireOutreachBatch(organizationId: string, now = Date.now()) {
  const previous = leases.get(organizationId);
  if (previous?.active || (previous && now - previous.startedAt < 250)) return null;
  const lease = { startedAt: now, active: true };
  leases.set(organizationId, lease);
  for (const [id, value] of leases) if (!value.active && now - value.startedAt > 60_000) leases.delete(id);
  return () => { lease.active = false; };
}
