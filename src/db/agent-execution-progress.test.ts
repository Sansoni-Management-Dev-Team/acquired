import { expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { AgentChannelStore } from './agent-channel-store';
import { AgentInvitationStore } from './agent-invitation-store';
import type { AgentThread } from './agent-store';

vi.mock('server-only', () => ({}));

const thread: AgentThread = { id: 'thread', organization_id: 'org', mandate_id: 'mandate', owner_user_id: 'owner', revision: 1 };
const observed = ['2026-10-21T01:00:00.000Z', '2026-10-21T01:02:00.000Z'];
const person = { id: 'person', phase: 'active', history_observed_at: new Date(observed[1]), history_coverage_fresh: true };
function route(id: string, channel: string, at = observed[0]) {
  return { id, channel, conversation_id: person.id, recipient_value: channel + ':recipient', binding_id: id + '-binding', platform: channel + '-platform', service_account_id: id + '-account', expected_routes: 2, history_complete: true, history_fresh: true, history_observed_at: new Date(at), route_ready: true, next_allowed_at: null };
}

function fixture() {
  const data = {
    people: [person] as Record<string, unknown>[],
    names: [{ id: person.id, lead_name: 'Saved person', company_name: 'Saved company', draft_pending: true, last_message_direction: 'inbound' }],
    routes: [route('email-route', 'email'), route('linkedin-route', 'linkedin', observed[1])] as Record<string, unknown>[],
    relationships: [{ route_id: 'linkedin-route', status: 'invitation_pending', can_message: false, observed_at: new Date(observed[1]) }],
    actions: [{ route_id: 'linkedin-route', state: 'pending' }],
    channelTable: true,
    invitationTable: true,
  };
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    void _values;
    if (sql.includes('coalesce((SELECT mode')) return { rows: [{ revision: '42', execution_mode: 'real' }] };
    if (sql.startsWith('SELECT * FROM agent_responsibilities')) return { rows: [{ id: 'responsibility', state: 'ready' }] };
    if (sql.includes('agent_context_revision(id)')) return { rows: data.people };
    if (sql.startsWith('SELECT state,result')) return { rows: [] };
    if (sql.endsWith('AS selection_empty')) return { rows: [{ selection_empty: false }] };
    if (sql.includes('person.display_name AS lead_name')) return { rows: data.names };
    if (sql.includes("to_regclass('public.agent_conversation_channels')")) return { rows: [{ installed: data.channelTable }] };
    if (sql.includes("to_regclass('public.agent_linkedin_relationships')")) return { rows: [{ installed: data.invitationTable }] };
    if (sql.startsWith('SELECT r.*,b.service_account_id')) return { rows: data.routes };
    if (sql.startsWith('SELECT * FROM agent_linkedin_relationships')) return { rows: data.relationships };
    if (sql.startsWith('SELECT DISTINCT ON(route_id)')) return { rows: data.actions };
    throw new Error('Unexpected progress query: ' + sql);
  });
  const client = { query } as unknown as PoolClient;
  class ChannelHarness extends AgentChannelStore {
    protected override async nativeTransaction<T>(work: (c: PoolClient) => Promise<T>, _preset?: unknown, readOnly=false) { expect(readOnly).toBe(true); return work(client); }
    protected override async thread() { return thread; }
  }
  class InvitationHarness extends AgentInvitationStore {
    protected override async nativeTransaction<T>(work: (c: PoolClient) => Promise<T>, _preset?: unknown, readOnly=false) { expect(readOnly).toBe(true); return work(client); }
    protected override async thread() { return thread; }
  }
  const actor = { organizationId: thread.organization_id, userId: thread.owner_user_id };
  return { data, query, channel: new ChannelHarness({} as never, actor), invitation: new InvitationHarness({} as never, actor) };
}

it('projects saved names, route senders and oldest coverage without replacing the combined history observation', async () => {
  const f = fixture();
  const result = await f.channel.executionState(thread.id);
  expect(result.conversations).toMatchObject([{
    id: person.id, lead_name: 'Saved person', company_name: 'Saved company', draft_pending: true, last_message_direction: 'inbound',
    history_observed_at: new Date(observed[1]), history_coverage_observed_at: observed[0], history_coverage_fresh: true,
    channels: [
      { id: 'email-route', channel: 'email', state: 'ready', bindingId: 'email-route-binding', senderLabel: 'email · email-platform · email-route-account' },
      { id: 'linkedin-route', channel: 'linkedin', state: 'ready', historyObservedAt: observed[1] },
    ],
  }]);
  const names = f.query.mock.calls.find(([sql]) => sql.includes('person.display_name AS lead_name'))!;
  expect(names[1]).toEqual([thread.id, thread.organization_id, thread.owner_user_id]);
  expect(names[0]).toContain('person.organization_id=v.organization_id');
  const routes = f.query.mock.calls.find(([sql]) => sql.startsWith('SELECT r.*,b.service_account_id'))!;
  expect(routes[1]).toEqual([thread.id]);
  expect(routes[0]).toContain("history_observed_at BETWEEN clock_timestamp()-interval '5 minutes' AND clock_timestamp()");
});

it('adds relationship and latest invitation status only to the matching projected route', async () => {
  const f = fixture();
  const result = await f.invitation.executionState(thread.id);
  const channels = result.conversations[0].channels as Record<string, unknown>[];
  expect(channels[0]).not.toHaveProperty('relationship');
  expect(channels[0]).not.toHaveProperty('invitationState');
  expect(channels[1]).toMatchObject({ id: 'linkedin-route', relationship: { status: 'invitation_pending', canMessage: false, observedAt: observed[1] }, invitationState: 'pending' });
  const actions = f.query.mock.calls.find(([sql]) => sql.startsWith('SELECT DISTINCT ON(route_id)'))!;
  expect(actions[1]).toEqual([thread.id]);
  expect(actions[0]).toContain('ORDER BY route_id,created_at DESC,operation_id');
  expect(f.query.mock.calls.findIndex(([sql]) => sql.startsWith('SELECT r.*,b.service_account_id'))).toBeLessThan(f.query.mock.calls.findIndex(([sql]) => sql.startsWith('SELECT * FROM agent_linkedin_relationships')));
});

it('retains named people without inventing routes or relationship state when optional tables are absent', async () => {
  const f = fixture(); f.data.channelTable = false; f.data.invitationTable = false;
  expect((await f.invitation.executionState(thread.id)).conversations).toEqual([{ ...person, ...f.data.names[0] }]);
  expect(f.query.mock.calls.some(([sql]) => sql.startsWith('SELECT r.*,b.service_account_id') || sql.startsWith('SELECT * FROM agent_linkedin_relationships') || sql.startsWith('SELECT DISTINCT ON(route_id)'))).toBe(false);
});

it.each(['missing_route', 'stale_route', 'missing_observation'] as const)('does not claim fresh combined coverage for %s', async kind => {
  const f = fixture();
  if (kind === 'missing_route') f.data.routes.pop();
  if (kind === 'stale_route') f.data.routes[1].history_fresh = false;
  if (kind === 'missing_observation') { f.data.routes[1].history_observed_at = null; f.data.routes[1].history_fresh = null; }
  const projected = (await f.channel.executionState(thread.id)).conversations[0];
  expect(projected.history_coverage_fresh).toBe(false);
  expect(projected.history_coverage_observed_at).toBe(kind === 'missing_observation' ? null : observed[0]);
});

it('preserves held person state over route readiness and distinguishes history checks from received replies', async () => {
  const f = fixture(); f.data.people[0] = { ...person, phase: 'held' };
  expect((await f.channel.executionState(thread.id)).conversations[0].channels).toMatchObject([{ state: 'held' }, { state: 'held' }]);
  f.data.people[0] = person;
  f.data.routes[0].history_complete = false;
  f.data.routes[1].route_ready = false; f.data.routes[1].cold_cancelled_at = observed[1];
  expect((await f.channel.executionState(thread.id)).conversations[0].channels).toMatchObject([{ state: 'waiting_history' }, { state: 'reply_received' }]);
});

it('propagates a failed projection read rather than returning partial readiness', async () => {
  const f = fixture();
  f.query.mockRejectedValueOnce(new Error('Read unavailable'));
  await expect(f.invitation.executionState(thread.id)).rejects.toThrow('Read unavailable');
});
