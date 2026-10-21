import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';

const directory = new URL('../../ops/agent-mode/production-proposals/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, directory), 'utf8');
const native = read('001-native-agent-baseline-v2.proposed.sql');
const hosted = read('002-hosted-demo-registration.proposed.sql');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function body(sql: string, name: string) {
  const header = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?\\bAS (\\$[a-zA-Z0-9_]*\\$)`).exec(sql);
  if (!header || header.index === undefined) throw Error(`Missing reviewed function ${name}`);
  const start = header.index + header[0].length;
  return sql.slice(start, sql.indexOf(header[1], start));
}

it('pins the exact reviewed artifacts and separates production from an empty isolated rehearsal', () => {
  const manifest = JSON.parse(read('approval-manifest.json'));
  const correction = JSON.parse(read('001-native-agent-baseline-v2.review.json'));
  expect(digest(native)).toBe(correction.sha256);
  expect(native).toBe(read(correction.supersedes.file).replace('DEFAULT public.local_simulator_business_now()', 'DEFAULT public.agent_business_now()'));
  for (const artifact of manifest.artifacts) expect(digest(read(artifact.file))).toBe(artifact.sha256);
  for (const sql of [native, hosted]) {
    expect(sql).toContain("target->>'environment'='production'");
    expect(sql).toContain("target->>'environment'='rehearsal'");
    expect(sql).toContain('7678071634733212629');
    expect(sql).toContain('acquire-hosted-demo-rehearsal-only');
  }
});

it('keeps the two final admission bodies byte-identical apart from production clock names', () => {
  const source = readFileSync(new URL('../../ops/agent-mode/migrations/127-app5437-gui-send-window.proposed.sql', import.meta.url), 'utf8');
  for (const name of ['agent_channel_operation_before_invitations', 'agent_invitation_before_company_projection']) {
    const production = body(native, name);
    expect(production.replaceAll('public.agent_business_now()', 'public.local_simulator_business_now()')).toBe(body(source, name));
    expect(hosted).toContain(digest(production));
  }
  expect(hosted).toContain("replace(pg_get_functiondef(to_regprocedure(signature)),needle||' AND NOT public.agent_hosted_demo_send_window_exempt(r.id)',needle) IS DISTINCT FROM definition");
});

it('does not install service storage, test registrations or simulated time in the application', () => {
  expect(native).not.toMatch(/CREATE (?:TABLE|SCHEMA) (?:public\.)?(?:communications|local_simulator_|agent_simulator_test_policies|agent_local_migrations)/);
  expect(native).not.toMatch(/(?:JOIN|FROM|UPDATE|INTO|PERFORM)\s+communications\.\w+/);
  expect(native).not.toContain('project_acquire');
  expect(native).toContain("RAISE EXCEPTION 'Production uses real wall time'");
  expect(body(native, 'agent_channel_local_binding')).toMatch(/RETURN false/);
  expect(body(native, 'communications_resolve_untracked_outbound')).toContain('review remains held');
  expect(hosted).not.toMatch(/INSERT INTO public\.agent_(?:demo_runs|hosted_demo_registrations)/);
});

it('matches demo replies using the owned saved run and retains the original mapping and binding checks', () => {
  const match = body(native, 'agent_recorded_demo_route_matches');
  expect(match).toContain('public.agent_demo_runtime_ready(run.id)');
  for (const guard of ['Held owned recorded route scope required', 'm.source_revision', 'public.agent_recorded_binding_digest(b.id)', "s->>'bindingDigest'=r.binding_digest", "r.recipient_value=CASE r.channel"]) expect(match).toContain(guard);
  expect(match).not.toContain('communications.connection_generations');
});

it('adds only nullable execution context to old dispatch intents and preserves source data', () => {
  const statements = native.replace(/(\$[a-zA-Z0-9_]*\$)[\s\S]*?\1/g, '');
  expect(native).toContain('ADD COLUMN execution_mandate_id uuid,ADD COLUMN execution_context_digest text,ADD COLUMN execution_mode text');
  expect(statements).not.toMatch(/(?:TRUNCATE|DELETE FROM) public\./);
  expect(statements).not.toMatch(/UPDATE public\.(?:contacts|targets|mandates|communication_bindings)\s/);
  expect(native).toContain('FROM PUBLIC,anon,authenticated,service_role');
});

it('uses only the production wall clock in table defaults', () => {
  expect(native).not.toMatch(/DEFAULT public\.local_simulator_business_now\(\)/);
  expect(native).toContain('available_at timestamp with time zone DEFAULT public.agent_business_now() NOT NULL');
});
