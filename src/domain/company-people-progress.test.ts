import { expect, it, vi } from 'vitest';
import { companyPeopleProgress, waitForCompanyPeople } from './company-people-progress';
it('keeps active and queued people research pending and retains partial coverage', () => {
  expect(companyPeopleProgress([{ status: 'running', profilesFound: 10, profilesSaved: 5, profilesFailed: 0 }, { status: 'queued', profilesFound: 0, profilesSaved: 0, profilesFailed: 0 }, { status: 'partial', profilesFound: 4, profilesSaved: 3, profilesFailed: 1 }])).toEqual({ admissionIncomplete: 0, total: 3, active: 1, queued: 1, complete: 0, failed: 1, cancelled: 0, found: 14, saved: 8, profilesFailed: 1, settled: false });
  expect(companyPeopleProgress([]).settled).toBe(true);
});
it('waits durably for people instead of finishing when companies have been saved', async () => {
  const poll = vi.fn().mockResolvedValueOnce({ settled: false }).mockResolvedValueOnce({ settled: true });
  const sleep = vi.fn(); const names: string[] = [];
  await waitForCompanyPeople({ poll, sleep, checkpoint: async (name, fn) => { names.push(name); return fn(); } });
  expect(names).toEqual(['company-people-0', 'company-people-1']);
  expect(sleep).toHaveBeenCalledExactlyOnceWith('company-people-wait-0', 10000);
});

it('RC-10-generalization: unattempted admission cancellations are settled separately from provider failures',()=>{ expect(companyPeopleProgress([{status:'cancelled',profilesFound:0,profilesSaved:0,profilesFailed:0}])).toMatchObject({cancelled:1,failed:0,settled:true}); });

it('RC-10-generalization: ineligible cancellation is separate from unattempted budget exhaustion',()=>{ const result=companyPeopleProgress([{status:'cancelled',profilesFound:0,profilesSaved:0,profilesFailed:0,error:{origin:'admission',reason:'ineligible'}},{status:'cancelled',profilesFound:0,profilesSaved:0,profilesFailed:0,error:{origin:'admission',reason:'deadline'}}]); expect(result).toMatchObject({cancelled:2,admissionIncomplete:1,failed:0,settled:true}); });
