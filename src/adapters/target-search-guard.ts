type SearchState = { inFlight: boolean; lastStartedAt: number };

const globalForSearchGuard = globalThis as typeof globalThis & { projectAcquireSearchStates?: Map<string, SearchState> };
const states = globalForSearchGuard.projectAcquireSearchStates ??= new Map<string, SearchState>();

export class TargetSearchRateLimitError extends Error {
  constructor(public retryAfterSeconds: number, message: string) { super(message); }
}

export function acquireTargetSearch(organizationId: string, options: { now?: number; cooldownMs?: number } = {}) {
  const now = options.now ?? Date.now();
  const cooldownMs = options.cooldownMs ?? Number(process.env.TARGET_SEARCH_COOLDOWN_MS || 3_000);
  const existing = states.get(organizationId);
  if (existing?.inFlight) throw new TargetSearchRateLimitError(1, "A target search is already running for this organisation.");
  const elapsed = existing ? now - existing.lastStartedAt : Number.POSITIVE_INFINITY;
  if (elapsed < cooldownMs) throw new TargetSearchRateLimitError(Math.max(1, Math.ceil((cooldownMs - elapsed) / 1_000)), "Please wait briefly before starting another target search.");
  states.set(organizationId, { inFlight: true, lastStartedAt: now });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = states.get(organizationId);
    if (current?.lastStartedAt === now) states.set(organizationId, { ...current, inFlight: false });
  };
}

export function clearTargetSearchGuardForTests() { states.clear(); }
