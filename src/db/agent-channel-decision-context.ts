import type { PoolClient } from 'pg';
import type { AgentConversationContext } from '@/lib/agent-conversation-engine';
import { agentReplyCausalitySchema } from '@/domain/agent-reply-causality';
import type { AgentThread } from './agent-store';

type DecisionChannel = NonNullable<AgentConversationContext['channels']>[number];
type DecisionRoute = Pick<DecisionChannel, 'id' | 'channel' | 'historyComplete' | 'historyObservedAt' | 'nextAllowedAt'>;
type ChannelDecisionContext = Pick<AgentConversationContext, 'channels'>;
type QueryClient = Pick<PoolClient, 'query'>;

/** Read projections use the caller's locked conversation and transaction client.
 * SQL remains authoritative for current action admission and reply causality;
 * these functions neither acquire send authority nor dispatch proposals. */
export async function projectAgentChannelDecisionContext(
    c: QueryClient,
    routes: readonly DecisionRoute[],
): Promise<ChannelDecisionContext> {
    if (!routes.length) return {};
    const channels: DecisionChannel[] = [];
    for (const r of routes) {
        const ready = (await c.query("SELECT public.agent_channel_proposal_permitted($1::uuid,'initial') OR public.agent_channel_proposal_permitted($1::uuid,'reply') OR public.agent_channel_proposal_permitted($1::uuid,'follow_up') AS allowed", [r.id])).rows[0]?.allowed === true;
        const installed = (await c.query("SELECT to_regprocedure('public.agent_channel_reply_causality(uuid)') IS NOT NULL AS installed")).rows[0]?.installed === true;
        const raw = installed ? (await c.query('SELECT public.agent_channel_reply_causality($1::uuid) AS causality', [r.id])).rows[0]?.causality : null;
        const causality = raw == null ? undefined : agentReplyCausalitySchema.parse(raw);
        channels.push({
            id: r.id,
            channel: r.channel,
            historyComplete: r.historyComplete,
            historyObservedAt: r.historyObservedAt,
            readiness: ready ? 'ready' : 'waiting',
            nextAllowedAt: r.nextAllowedAt,
            ...(causality ? { unansweredInboundHistoryId: causality.answeredInboundHistoryId } : {}),
        });
    }
    return { channels };
}

export async function projectAgentInvitationDecisionContext(
    c: QueryClient,
    t: AgentThread,
    row: Record<string, unknown>,
    base: ChannelDecisionContext,
): Promise<ChannelDecisionContext> {
    if (!Array.isArray(base.channels)) return base;
    const installed = (await c.query("SELECT to_regclass('public.agent_linkedin_relationships') IS NOT NULL AS installed")).rows[0]?.installed === true;
    if (!installed) return base;
    const observations = (await c.query('SELECT * FROM agent_linkedin_relationships WHERE conversation_id=$1 AND thread_id=$2', [row.id, t.id])).rows;
    const requested=base.channels.flatMap(route=>['initial','reply','follow_up',...(route.channel==='linkedin'?['invitation']:[])].map(action=>({routeId:route.id,action})));
    const permissions=(await c.query('SELECT requested.route_id,requested.action,public.agent_channel_proposal_permitted(requested.route_id,requested.action) AS allowed FROM unnest($1::uuid[],$2::text[]) AS requested(route_id,action)',[requested.map(r=>r.routeId),requested.map(r=>r.action)])).rows;
    const channels: DecisionChannel[] = [];
    for (const route of base.channels) {
        const saved = observations.find(r => r.route_id === route.id), allowedActions: NonNullable<DecisionChannel['allowedActions']> = [];
        for (const action of ['initial', 'reply', 'follow_up', ...(route.channel === 'linkedin' ? ['invitation' as const] : [])] as const) {
            if (permissions.some(row=>row.route_id===route.id&&row.action===action&&row.allowed===true)) {
                allowedActions.push(action);
            }
        }
        channels.push({
            ...route,
            readiness: allowedActions.length ? 'ready' : 'waiting',
            allowedActions,
            ...(saved ? { relationship: { status: saved.status, canMessage: saved.can_message, observedAt: new Date(saved.observed_at).toISOString() } } : {}),
        });
    }
    return { ...base, channels };
}
