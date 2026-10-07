export type CompanyPeopleRun = { status: string; profilesFound: number; profilesSaved: number; profilesFailed: number; error?: unknown };
export function companyPeopleProgress(runs: CompanyPeopleRun[]) {
  const active = runs.filter(run => run.status === 'running').length;
  const queued = runs.filter(run => run.status === 'queued').length;
  const admission: { admissionIncomplete?: number } = { admissionIncomplete: runs.filter(run => {
    const error = run.error && typeof run.error === 'object' ? run.error as { origin?: string; reason?: string } : undefined;
    return run.status === 'cancelled' && error?.origin === 'admission' && ['deadline', 'insufficient_budget'].includes(error.reason || '');
  }).length };
  return { ...admission, total: runs.length, active, queued, complete: runs.filter(run => run.status === 'complete').length,
    cancelled: runs.filter(run => run.status === 'cancelled').length,
    failed: runs.filter(run => ['failed', 'partial'].includes(run.status)).length,
    found: runs.reduce((n, run) => n + run.profilesFound, 0), saved: runs.reduce((n, run) => n + run.profilesSaved, 0),
    profilesFailed: runs.reduce((n, run) => n + run.profilesFailed, 0), settled: active + queued === 0 };
}
export async function waitForCompanyPeople(deps: {
  checkpoint: <T>(name: string, run: () => Promise<T>) => Promise<T>;
  poll: () => Promise<{ settled: boolean }>;
  sleep: (name: string, ms: number) => Promise<unknown>;
}) {
  for (let attempt = 0; ; attempt++) {
    const state = await deps.checkpoint(`company-people-${attempt}`, deps.poll);
    if (state.settled) return;
    await deps.sleep(`company-people-wait-${attempt}`, 10000);
  }
}
