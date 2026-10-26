import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ResearchSettingsForm } from './research-settings-form';
let tree: ReactTestRenderer;
const request = vi.fn();
beforeEach(async () => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', request); request.mockReset(); await act(async () => { tree = create(<ResearchSettingsForm initialTarget={20} />); }); });
afterEach(async () => { await act(async () => tree.unmount()); vi.unstubAllGlobals(); });
async function change(value: string) { await act(async () => tree.root.findByType('input').props.onChange({ target: { value } })); }
async function save() { await act(async () => tree.root.findByType('button').props.onClick()); }
it.each(['', '0', '101', '1.5', '-2'])('rejects invalid target %s before submission', async value => {
  await change(value); expect(tree.root.findByType('input').props['aria-invalid']).toBe(true); expect(tree.root.findByType('button').props.disabled).toBe(true); expect(request).not.toHaveBeenCalled();
});
it.each(['1', '100'])('saves valid boundary %s as an integer', async value => {
  request.mockResolvedValue(Response.json({})); await change(value); await save();
  expect(request).toHaveBeenCalledWith('/api/settings/research', expect.objectContaining({ method: 'POST', body: JSON.stringify({ defaultTargetBusinesses: Number(value) }) }));
  expect(tree.root.findByProps({ role: 'status' }).children).toEqual(['Saved.']); expect(tree.root.findByType('button').props.disabled).toBe(false);
});
it.each(['Permission denied', undefined])('surfaces server rejections and preserves the unsaved value (%s)', async error => {
  request.mockResolvedValue(Response.json({ error }, { status: 403 })); await change('35'); await save();
  expect(tree.root.findByProps({ role: 'status' }).children).toEqual([error || 'Could not save research settings.']); expect(tree.root.findByType('input').props.value).toBe(35); expect(tree.root.findByType('button').props.disabled).toBe(false);
});
it.each([new Error('Connection lost'), 'unknown failure'])('recovers from transport failures (%s)', async error => {
  request.mockRejectedValue(error); await save(); expect(tree.root.findByProps({ role: 'status' }).children).toEqual([error instanceof Error ? error.message : 'Could not save research settings.']); expect(tree.root.findByType('button').props.disabled).toBe(false);
});
it('prevents another save while a request is pending', async () => {
  let resolve!: (value: Response) => void; request.mockReturnValue(new Promise(done => { resolve = done; })); let pending!: Promise<void>;
  await act(async () => { pending = tree.root.findByType('button').props.onClick(); });
  expect(tree.root.findByType('button').props.disabled).toBe(true);
  await act(async () => { resolve(Response.json({})); await pending; }); expect(tree.root.findByType('button').props.disabled).toBe(false);
});
