/** One awaited native tick lane in the existing persistent app process. The
 * authenticated tick retains all saved scope, approval and dispatch checks. */
export async function startAgentBackgroundWorker(env, {
  lifecycle = process,
  loadWorker = () => import('./native-agent-driver.mjs'),
  onFatal = () => {
    console.error('Native background worker stopped unexpectedly');
    process.exitCode = 1;
    process.kill(process.pid, 'SIGTERM');
  },
} = {}) {
  if (env.AGENT_BACKGROUND_WORKER_ENABLED !== 'true') return undefined;
  if (env.NODE_ENV !== 'production' || env.AGENT_DURABLE_STATE_ENABLED !== 'true'
      || env.AGENT_NATIVE_EXECUTION_ENABLED !== 'true' || env.AGENT_WORKER_SCOPE_MODE !== 'registered'
      || env.AGENT_WORKER_REQUIRE_MANDATE_SCOPE !== 'true' || env.AGENT_WORKER_MANDATE_ID !== undefined
      || !/^[a-z][a-z0-9-]{2,99}$/.test(env.AGENT_WORKER_RUNTIME_ID ?? '')
      || typeof env.AGENT_WORKER_SECRET !== 'string' || !/^[A-Za-z0-9_-]{32,200}$/.test(env.AGENT_WORKER_SECRET)) {
    throw Error('Registered native background worker configuration required');
  }
  const { runNativeWorker } = await loadWorker();
  const controller = new AbortController();
  const stop = () => controller.abort();
  lifecycle.once('SIGINT', stop);
  lifecycle.once('SIGTERM', stop);
  const done = Promise.resolve().then(() => runNativeWorker({
    nativeSecret: env.AGENT_WORKER_SECRET,
    signal: controller.signal,
    pollingMode: 'adaptive',
    // The production research service already owns scheduled maintenance.
    maintenance: async () => ({ pending: 0 }),
  })).catch(() => {
    if (!controller.signal.aborted) onFatal();
  }).finally(() => {
    controller.abort();
    lifecycle.removeListener('SIGINT', stop);
    lifecycle.removeListener('SIGTERM', stop);
  });
  return { done, stop };
}
