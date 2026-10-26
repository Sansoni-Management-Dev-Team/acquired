import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DetailTooltip } from './detail-tooltip';
vi.mock('react-dom', () => ({ createPortal: (children: React.ReactNode) => children }));
let tree: ReactTestRenderer;
const listeners = new Map<string, (event?: unknown) => void>();
const viewport = { innerWidth: 430, innerHeight: 800, addEventListener: vi.fn(), removeEventListener: vi.fn() };
const rect = { top: 100, bottom: 130, left: 400 };
class FakeElement { constructor(private inTooltip: boolean) {} closest() { return this.inTooltip ? this : null; } }
beforeEach(async () => {
  vi.useFakeTimers(); listeners.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('document', { body: {} }); vi.stubGlobal('Element', FakeElement); vi.stubGlobal('window', viewport);
  viewport.innerWidth = 430; viewport.innerHeight = 800; viewport.removeEventListener.mockClear(); viewport.addEventListener.mockImplementation((name, callback) => listeners.set(name, callback));
  Object.assign(rect, { top: 100, bottom: 130, left: 400 });
  await act(async () => { tree = create(<DetailTooltip content="Source explanation">Details</DetailTooltip>, { createNodeMock: node => node.type === 'button' ? { getBoundingClientRect: () => rect } : null }); });
});
afterEach(async () => { await act(async () => tree.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
const tooltip = () => tree.root.findByProps({ role: 'tooltip' });
async function open() { await act(async () => tree.root.findByType('button').props.onFocus()); }
it('opens on keyboard focus with a linked description inside the viewport', async () => {
  await open(); expect(tooltip().children).toEqual(['Source explanation']); expect(tree.root.findByType('button').props['aria-describedby']).toBe(tooltip().props.id);
  expect(tooltip().props.style).toMatchObject({ left: 34, width: 384, top: 138, maxHeight: 320 });
});
it('positions above a trigger near the bottom and fits narrow screens', async () => {
  viewport.innerWidth = 320; Object.assign(rect, { top: 700, bottom: 730, left: 4 }); await open(); expect(tooltip().props.style).toMatchObject({ width: 296, left: 12, top: 372 });
});
it('keeps the tooltip open while the pointer moves from the trigger into its content', async () => {
  await open(); await act(async () => tree.root.findByType('button').props.onMouseLeave());
  await act(async () => { vi.advanceTimersByTime(100); tooltip().props.onMouseEnter(); vi.advanceTimersByTime(100); }); expect(tooltip()).toBeDefined();
  await act(async () => { tooltip().props.onMouseLeave(); vi.advanceTimersByTime(150); }); expect(tree.root.findAllByProps({ role: 'tooltip' })).toHaveLength(0);
});
it('closes on Escape without waiting for the hover timer', async () => {
  await open(); await act(async () => tree.root.findByType('span').props.onKeyDown({ key: 'Escape' })); expect(tree.root.findAllByProps({ role: 'tooltip' })).toHaveLength(0);
});
it('allows internal tooltip scrolling but closes when the surrounding page scrolls', async () => {
  await open(); await act(async () => listeners.get('scroll')!({ target: new FakeElement(true) })); expect(tooltip()).toBeDefined();
  await act(async () => listeners.get('scroll')!({ target: new FakeElement(false) })); expect(tree.root.findAllByProps({ role: 'tooltip' })).toHaveLength(0);
});
it('closes on resize and unregisters positioning listeners', async () => {
  await open(); const resize = listeners.get('resize'); await act(async () => resize!()); expect(tree.root.findAllByProps({ role: 'tooltip' })).toHaveLength(0); expect(viewport.removeEventListener).toHaveBeenCalledWith('resize', resize);
});
