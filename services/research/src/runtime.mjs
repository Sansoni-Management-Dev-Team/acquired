// Translate only the Workflow APIs Acquire uses. The workflow algorithms stay unchanged.
export function durationMs(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  const match = /^(\d+(?:\.\d+)?) (milliseconds?|seconds?|minutes?|hours?)$/.exec(value);
  if (!match) throw new Error('Unsupported workflow duration');
  return Number(match[1]) * ({millisecond:1,second:1000,minute:60000,hour:3600000}[match[2].replace(/s$/, '')]);
}

export function workflowStep(engine) {
  return {
    do(name, options, body) {
      if (typeof options === 'function') { body = options; options = {}; }
      const retries = options.retries || {};
      return engine.runStep(body, {
        name,
        retriesAllowed: (retries.limit ?? 0) > 0,
        maxAttempts: (retries.limit ?? 0) + 1,
        intervalSeconds: durationMs(retries.delay ?? 1000) / 1000,
        backoffRate: retries.backoff === 'exponential' ? 2 : 1,
        ...(options.timeout ? {timeoutMS:durationMs(options.timeout)} : {}),
      });
    },
    sleep(_name, duration) { return engine.sleep(durationMs(duration)); },
  };
}

export function workflowBinding(engine, kind, run, queueName) {
  const key = id => `${kind}:${id}`;
  const conflict = () => Object.assign(new Error('Workflow input conflict'), {status:409});
  return {
    async createBatch(items) {
      for (const {id, params} of items) {
        let existing = await engine.getWorkflowStatus(key(id));
        if (!existing) {
          await engine.startWorkflow(run, {workflowID:key(id), queueName})(params);
          existing = await engine.getWorkflowStatus(key(id));
        }
        // A concurrent creator can win admission; its original input stays authoritative.
        if (JSON.stringify(existing?.input) !== JSON.stringify([params])) throw conflict();
      }
    },
    async get(id) {
      return {
        async status() {
          const row = await engine.getWorkflowStatus(key(id));
          if (!row) throw Object.assign(new Error('Workflow not found'), {status:404});
          const states = {ENQUEUED:'queued', DELAYED:'waiting', PENDING:'running', SUCCESS:'complete', ERROR:'errored', CANCELLED:'terminated', MAX_RECOVERY_ATTEMPTS_EXCEEDED:'errored'};
          return {status:states[row.status] || 'unknown',...(['MAX_RECOVERY_ATTEMPTS_EXCEEDED','CANCELLED'].includes(row.status)?{recoverable:true}:{})};
        },
        terminate() { return engine.cancelWorkflow(key(id)); },
        async restart() {
          const row=await engine.getWorkflowStatus(key(id));
          if(['MAX_RECOVERY_ATTEMPTS_EXCEEDED','CANCELLED'].includes(row?.status))await engine.resumeWorkflow(key(id),{queueName});
        },
      };
    },
  };
}
