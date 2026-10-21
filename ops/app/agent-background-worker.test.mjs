import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startAgentBackgroundWorker } from './agent-background-worker.mjs';

const enabled = {
  NODE_ENV: 'production', AGENT_BACKGROUND_WORKER_ENABLED: 'true',
  AGENT_DURABLE_STATE_ENABLED: 'true', AGENT_NATIVE_EXECUTION_ENABLED: 'true',
  AGENT_WORKER_SCOPE_MODE: 'registered', AGENT_WORKER_REQUIRE_MANDATE_SCOPE: 'true',
  AGENT_WORKER_RUNTIME_ID: 'acquire-hosted-demo-v1', AGENT_WORKER_SECRET: 'x'.repeat(48),
};

test('disabled hosted worker loads nothing and starts no polling', async () => {
  let loads = 0;
  assert.equal(await startAgentBackgroundWorker({}, { loadWorker: async () => { loads++; } }), undefined);
  assert.equal(loads, 0);
});

test('hosted worker refuses enabled but unrestricted or incomplete execution settings', async () => {
  for (const patch of [
    { NODE_ENV: 'development' }, { AGENT_DURABLE_STATE_ENABLED: 'false' },
    { AGENT_NATIVE_EXECUTION_ENABLED: 'false' }, { AGENT_WORKER_SCOPE_MODE: 'exact' },
    { AGENT_WORKER_REQUIRE_MANDATE_SCOPE: 'false' }, { AGENT_WORKER_RUNTIME_ID: '' },
    { AGENT_WORKER_MANDATE_ID: 'unexpected' }, { AGENT_WORKER_SECRET: '' },
  ]) {
    await assert.rejects(startAgentBackgroundWorker({ ...enabled, ...patch }), /Registered native background worker configuration required/);
  }
});

test('hosted worker uses the existing adaptive native driver and aborts with the app', async () => {
  const lifecycle = new EventEmitter();
  let calls = 0, options;
  const worker = await startAgentBackgroundWorker(enabled, {
    lifecycle,
    loadWorker: async () => ({ runNativeWorker: async input => {
      calls++; options = input;
      await new Promise(resolve => input.signal.addEventListener('abort', resolve, { once: true }));
    } }),
  });
  assert.equal(calls, 1);
  assert.equal(options.nativeSecret, enabled.AGENT_WORKER_SECRET);
  assert.equal(options.pollingMode, 'adaptive');
  assert.equal(options.researchSecret, undefined);
  // Existing production research scheduling stays independent.
  assert.deepEqual(await options.maintenance(), { pending: 0 });
  lifecycle.emit('SIGTERM');
  await worker.done;
  assert.equal(options.signal.aborted, true);
  assert.equal(lifecycle.listenerCount('SIGTERM'), 0);
  assert.equal(lifecycle.listenerCount('SIGINT'), 0);
});

test('an unexpected driver failure requests app restart without exposing its error', async () => {
  let failed = 0;
  const lifecycle = new EventEmitter();
  const worker = await startAgentBackgroundWorker(enabled, {
    lifecycle,
    loadWorker: async () => ({ runNativeWorker: async () => { throw Error('private credential'); } }),
    onFatal: () => { failed++; },
  });
  await worker.done;
  assert.equal(failed, 1);
  assert.equal(lifecycle.listenerCount('SIGTERM'), 0);
});
