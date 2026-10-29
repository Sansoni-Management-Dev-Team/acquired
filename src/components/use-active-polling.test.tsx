import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useActivePolling } from './use-active-polling';
let tree: ReactTestRenderer | undefined;
let visibility: (() => void) | undefined;
const documentFixture = { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
function Probe({ refresh, active = false, scope = 'a', initial = true }: { refresh: () => Promise<unknown> | void; active?: boolean; scope?: string; initial?: boolean }) { useActivePolling(refresh, { active, intervalMs: 100, key: scope, initial }); return null; }
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('document', documentFixture); documentFixture.hidden = false;
  documentFixture.addEventListener.mockImplementation((_name, callback) => { visibility = callback; }); documentFixture.removeEventListener.mockClear();
});
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });
async function mount(props: Parameters<typeof Probe>[0]) { await act(async () => { tree = create(<Probe {...props} />); }); }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
it('fetches once while idle and refreshes on a changed scope', async () => {
  const refresh = vi.fn(); await mount({ refresh }); await advance(500); expect(refresh).toHaveBeenCalledOnce();
  await act(async () => tree!.update(<Probe refresh={refresh} scope="b" />)); expect(refresh).toHaveBeenCalledTimes(2);
});
it('polls active work, skips hidden tabs, and refreshes when visible again', async () => {
  const refresh = vi.fn(); await mount({ refresh, active: true }); await advance(200); expect(refresh).toHaveBeenCalledTimes(3);
  documentFixture.hidden = true; await advance(300); await act(async () => visibility!()); expect(refresh).toHaveBeenCalledTimes(3);
  documentFixture.hidden = false; await act(async () => visibility!()); expect(refresh).toHaveBeenCalledTimes(4);
});
it('does not overlap requests and resumes once the pending request completes', async () => {
  let finish!: () => void; const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await mount({ refresh, active: true }); await advance(500); expect(refresh).toHaveBeenCalledOnce();
  await act(async () => { finish(); }); await advance(100); expect(refresh).toHaveBeenCalledTimes(2);
});
it('fetches the terminal state once and stops the interval when activity ends', async () => {
  const refresh = vi.fn(); await mount({ refresh, active: true }); await act(async () => tree!.update(<Probe refresh={refresh} active={false} />)); expect(refresh).toHaveBeenCalledTimes(2); await advance(500); expect(refresh).toHaveBeenCalledTimes(2);
});
it('uses the latest refresh callback without restarting the initial fetch', async () => {
  const first = vi.fn(), second = vi.fn(); await mount({ refresh: first, active: true }); await act(async () => tree!.update(<Probe refresh={second} active />)); await advance(100); expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
});
it('honours an opted-out initial fetch and removes timers/listeners on unmount', async () => {
  const refresh = vi.fn(); await mount({ refresh, active: true, initial: false }); expect(refresh).not.toHaveBeenCalled();
  const callback = visibility; await act(async () => tree!.unmount()); tree = undefined; await advance(500); expect(refresh).not.toHaveBeenCalled(); expect(documentFixture.removeEventListener).toHaveBeenCalledWith('visibilitychange', callback);
});
