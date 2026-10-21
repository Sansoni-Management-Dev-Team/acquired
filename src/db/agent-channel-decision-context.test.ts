import { expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { AgentChannelStore } from './agent-channel-store';
import { AgentInvitationStore } from './agent-invitation-store';
import type { AgentThread } from './agent-store';
import { createAgentBusinessTimeContext } from '@/lib/agent-business-time';

vi.mock('server-only', () => ({}));

const id = '10000000-0000-4000-8000-000000000001';
const emailRoute = '10000000-0000-4000-8000-000000000002';
const linkedinRoute = '10000000-0000-4000-8000-000000000003';
const now = '2030-01-07T00:00:00.000Z';
const revision = 'a'.repeat(64);
const thread: AgentThread = { id, organization_id: 'org', mandate_id: id, owner_user_id: 'owner', revision: 1 };
const causality = { version: 1, answeredInboundHistoryId: 'original-inbound', consumedInboundHistoryIds: ['original-inbound'], historyRevision: revision, routeHistoryRevision: revision, inboundAt: now };
function route(routeId: string, channel: 'email' | 'linkedin') {
  return { id: routeId, conversation_id: id, channel, binding_id: routeId, binding_digest: revision, recipient_kind: channel === 'email' ? 'email' : 'linkedin_profile', recipient_value: channel + ':recipient', identity_revision: '1', revision: 1, policy_revision: 2, history: [], history_complete: true, history_revision: revision, history_observed_at: new Date(now), next_allowed_at: null, cold_cancelled_at: null };
}

function fixture() {
  const data = {
    routes: [route(emailRoute, 'email'), route(linkedinRoute, 'linkedin')],
    channelInstalled: true,
    causalityInstalled: true,
    relationshipInstalled: true,
    causality: causality as unknown,
    ordinaryReady: new Set([emailRoute]),
    allowed: new Set([emailRoute + ':reply', linkedinRoute + ':invitation']),
    relationships: [{ route_id: linkedinRoute, status: 'not_connected', can_message: false, observed_at: new Date(now) }],
    failure: undefined as string | undefined,
  };
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (data.failure && sql.includes(data.failure)) throw new Error('Projection unavailable');
    if (sql.includes('agent_company_membership_projection')) return { rows: [{ installed: false }], rowCount: 1 };
    if (sql.startsWith('SELECT id,revision,state,input FROM agent_operations')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT 1 FROM agent_responsibilities')) return { rows: [{}], rowCount: 1 };
    if (sql.includes("to_regclass('public.agent_conversation_channels')")) return { rows: [{ installed: data.channelInstalled }], rowCount: 1 };
    if (sql.startsWith('SELECT r.*,p.revision AS policy_revision')) return { rows: data.routes, rowCount: data.routes.length };
    if (sql.includes("'initial') OR")) return { rows: [{ allowed: data.ordinaryReady.has(String(values?.[0])) }], rowCount: 1 };
    if (sql.includes("to_regprocedure('public.agent_channel_reply_causality(uuid)')")) return { rows: [{ installed: data.causalityInstalled }], rowCount: 1 };
    if (sql.startsWith('SELECT public.agent_channel_reply_causality')) return { rows: [{ causality: data.causality }], rowCount: 1 };
    if (sql.includes("to_regclass('public.agent_linkedin_relationships')")) return { rows: [{ installed: data.relationshipInstalled }], rowCount: 1 };
    if (sql.startsWith('SELECT * FROM agent_linkedin_relationships')) return { rows: data.relationships, rowCount: data.relationships.length };
    if (sql.startsWith('SELECT public.agent_channel_proposal_permitted($1::uuid,$2)')) return { rows: [{ allowed: data.allowed.has(values?.join(':') ?? '') }], rowCount: 1 };
    throw new Error('Unexpected query: ' + sql);
  });
  const client = { query } as unknown as PoolClient;
  const locks: string[] = [];
  const conversation = { id, contact_id: id, responsibility_id: id, epoch: '3', revision: 4, reminder_generation: 5, context_revision: revision, phase: 'active', driver_kind: 'agent', delivery_mode: 'communications', history_complete: true, history_observed_at: new Date(now), history: [] };
  class ChannelHarness extends AgentChannelStore {
    protected override async nativeTransaction<T>(work: (c: PoolClient) => Promise<T>) { return work(client); }
    protected override async thread() { return thread; }
    protected override async lockConversation(_c: PoolClient, _t: AgentThread, conversationId: string) { void _c; void _t; locks.push(conversationId); return conversation; }
    protected override async publicConversationFacts() { return { goal: 'Review the saved mandate', contactName: 'Saved lead', companyName: 'Saved company' }; }
  }
  class InvitationHarness extends AgentInvitationStore {
    protected override async nativeTransaction<T>(work: (c: PoolClient) => Promise<T>) { return work(client); }
    protected override async thread() { return thread; }
    protected override async lockConversation(_c: PoolClient, _t: AgentThread, conversationId: string) { void _c; void _t; locks.push(conversationId); return conversation; }
    protected override async publicConversationFacts() { return { goal: 'Review the saved mandate', contactName: 'Saved lead', companyName: 'Saved company' }; }
  }
  const actor = { organizationId: thread.organization_id, userId: thread.owner_user_id };
  const scope = { ...actor, runId: 'decision-context-clock' };
  const options = { businessTime: { context: createAgentBusinessTimeContext(scope, { now: () => Date.parse(now) }), scope } };
  return { data, query, locks, channel: new ChannelHarness({} as never, actor, options), invitation: new InvitationHarness({} as never, actor, options) };
}

it('preserves exact ordered routes, protected reply candidates and recorded future-business-clock observations', async () => {
  const f = fixture();
  const context = await f.channel.nativeDecisionContext(id, id);
  expect(context).toMatchObject({ conversationId: id, epoch: 3, revision: 4, reminderGeneration: 5, historyObservedAt: now });
  expect(context.channels).toEqual([
    { id: emailRoute, channel: 'email', historyComplete: true, historyObservedAt: now, readiness: 'ready', nextAllowedAt: null, unansweredInboundHistoryId: 'original-inbound' },
    { id: linkedinRoute, channel: 'linkedin', historyComplete: true, historyObservedAt: now, readiness: 'waiting', nextAllowedAt: null, unansweredInboundHistoryId: 'original-inbound' },
  ]);
  expect(f.locks).toEqual([id, id]);
  const routeRead = f.query.mock.calls.find(([sql]) => sql.startsWith('SELECT r.*,p.revision'))!;
  expect(routeRead[1]).toEqual([id, thread.id]);
  expect(routeRead[0]).toContain('ORDER BY array_position(p.channel_order,r.channel),r.id');
  expect(f.query.mock.calls.filter(([sql]) => sql.startsWith('SELECT public.agent_channel_reply_causality')).map(([, values]) => values)).toEqual([[emailRoute], [linkedinRoute]]);
});

it('composes relationship and invitation-only admission after ordinary route projection on the same client', async () => {
  const f = fixture();
  const context = await f.invitation.nativeDecisionContext(id, id);
  expect(context.channels).toMatchObject([
    { id: emailRoute, readiness: 'ready', allowedActions: ['reply'], unansweredInboundHistoryId: 'original-inbound' },
    { id: linkedinRoute, readiness: 'ready', allowedActions: ['invitation'], relationship: { status: 'not_connected', canMessage: false, observedAt: now } },
  ]);
  expect(context.channels![0]).not.toHaveProperty('relationship');
  const calls = f.query.mock.calls;
  expect(calls.find(([sql]) => sql.startsWith('SELECT * FROM agent_linkedin_relationships'))?.[1]).toEqual([id, thread.id]);
  expect(calls.filter(([sql]) => sql.startsWith('SELECT public.agent_channel_proposal_permitted($1::uuid,$2)')).map(([, values]) => values)).toEqual([
    [emailRoute, 'initial'], [emailRoute, 'reply'], [emailRoute, 'follow_up'],
    [linkedinRoute, 'initial'], [linkedinRoute, 'reply'], [linkedinRoute, 'follow_up'], [linkedinRoute, 'invitation'],
  ]);
  expect(calls.findIndex(([sql]) => sql.startsWith('SELECT * FROM agent_linkedin_relationships'))).toBeGreaterThan(calls.map(([sql]) => sql).lastIndexOf('SELECT public.agent_channel_reply_causality($1::uuid) AS causality'));
});

it.each(['missing_table', 'no_routes'] as const)('omits channel authority and invitation queries for %s', async kind => {
  const f = fixture();
  if (kind === 'missing_table') f.data.channelInstalled = false;
  else f.data.routes = [];
  expect(await f.invitation.nativeDecisionContext(id, id)).not.toHaveProperty('channels');
  expect(f.query.mock.calls.some(([sql]) => sql.includes('agent_linkedin_relationships') || sql.startsWith('SELECT public.agent_channel_proposal_permitted'))).toBe(false);
});

it.each(['missing_function', 'null_result'] as const)('does not invent a protected reply candidate for %s', async kind => {
  const f = fixture();
  if (kind === 'missing_function') f.data.causalityInstalled = false;
  else f.data.causality = null;
  const context = await f.channel.nativeDecisionContext(id, id);
  for (const channel of context.channels!) expect(channel).not.toHaveProperty('unansweredInboundHistoryId');
  if (kind === 'missing_function') expect(f.query.mock.calls.some(([sql]) => sql.startsWith('SELECT public.agent_channel_reply_causality'))).toBe(false);
});

it('preserves ordinary admission when optional relationship data is unavailable', async () => {
  const f = fixture(); f.data.relationshipInstalled = false;
  const context = await f.invitation.nativeDecisionContext(id, id);
  expect(context.channels!.map(channel => channel.readiness)).toEqual(['ready', 'waiting']);
  for (const channel of context.channels!) {
    expect(channel).not.toHaveProperty('allowedActions');
    expect(channel).not.toHaveProperty('relationship');
  }
});

it('does not treat relationship facts as action permission when every SQL admission is refused', async () => {
  const f = fixture(); f.data.allowed.clear();
  const context = await f.invitation.nativeDecisionContext(id, id);
  expect(context.channels!.map(channel => [channel.readiness, channel.allowedActions])).toEqual([['waiting', []], ['waiting', []]]);
  expect(context.channels![1].relationship?.status).toBe('not_connected');
});

it('rejects malformed protected causality rather than returning permissive partial context', async () => {
  const f = fixture(); f.data.causality = { ...causality, consumedInboundHistoryIds: [] };
  await expect(f.invitation.nativeDecisionContext(id, id)).rejects.toThrow('Exact unique consumed person turn required');
  expect(f.query.mock.calls.some(([sql]) => sql.includes('agent_linkedin_relationships'))).toBe(false);
});

it('propagates a relationship read failure without returning the ordinary context', async () => {
  const f = fixture(); f.data.failure = 'SELECT * FROM agent_linkedin_relationships';
  await expect(f.invitation.nativeDecisionContext(id, id)).rejects.toThrow('Projection unavailable');
});
