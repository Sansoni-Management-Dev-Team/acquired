import { afterAll, beforeAll, expect, it } from 'vitest';
import { Client } from 'pg';
const enabled = process.env.RUN_AGENT_LOCAL_INTEGRATION === 'true';
const client = new Client({ connectionString: 'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode' });
beforeAll(async () => { if (!enabled) return; await client.connect(); const identity = (await client.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0]; expect(identity).toEqual({ name: 'acquire_agent_mode', marker: 'acquire-agent-mode-local-only' }); });
afterAll(async () => { if (enabled) await client.end(); });
it.runIf(enabled)('has durable agent tables alongside imported business records', async () => {
 for (const table of ['agent_threads','agent_messages','agent_operations','agent_events','agent_runs','agent_responsibilities']) expect((await client.query('SELECT to_regclass($1) AS name', [table])).rows[0].name, table).not.toBeNull();
 expect(Number((await client.query('SELECT count(*) n FROM mandates')).rows[0].n)).toBeGreaterThan(0);
});
