import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ cooldown: vi.fn(), select: vi.fn(), update: vi.fn(), set: vi.fn() }));
vi.mock('@/db/client', () => ({ requireDb: () => ({ select: mocks.select, update: mocks.update }) }));
vi.mock('@/domain/research-provider-queue', async original => {
  const actual = await original<typeof import('@/domain/research-provider-queue')>();
  mocks.cooldown.mockImplementation(actual.coolDownBrowser);
  return { ...actual, coolDownBrowser: mocks.cooldown };
});
import { coolDownResearchBrowser } from './research-provider-queue';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.select.mockReturnValue({ from: () => ({ orderBy: () => ({ limit: async () => [{ id: 'job', queue: {}, legacy: 0, now: 1000 }] }) }) });
  mocks.set.mockReturnValue({ where: () => ({ returning: async () => [{ id: 'job' }] }) });
  mocks.update.mockReturnValue({ set: mocks.set });
});
it('persists scoped website cooldown through the SQL compare-and-swap fallback', async () => {
  expect(await coolDownResearchBrowser(12000, 'example.com')).toBe(true);
  expect(mocks.cooldown).toHaveBeenCalledWith({}, 1000, 12000, 'example.com');
  expect(mocks.cooldown.mock.results[0].value).toEqual({ domainAfter: { 'example.com': 13000 } });
  expect(mocks.set).toHaveBeenCalledOnce();
});
it('preserves global cooldown when the shared reader is full', async () => {
  await coolDownResearchBrowser(12000);
  expect(mocks.cooldown).toHaveBeenCalledWith({}, 1000, 12000, undefined);
  expect(mocks.cooldown.mock.results[0].value).toEqual({ browserCooldownUntil: 13000 });
});
