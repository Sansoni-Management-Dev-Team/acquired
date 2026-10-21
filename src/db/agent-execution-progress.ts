import type { PoolClient } from 'pg';
import type { AgentThread } from './agent-store';

/** Read-only projections inside the caller's owned transaction. The caller keeps
 * role, membership, locking and business-clock selection; these functions never
 * connect, commit, approve work or change conversation/dispatch state. */
export async function projectAgentChannelExecutionProgress<T extends Record<string, unknown>>(
    c: Pick<PoolClient, 'query'>,
    t: AgentThread,
    conversations: T[],
    businessSql: string,
): Promise<T[]> {
    const people = (
        await c.query(`SELECT v.id,person.display_name AS lead_name,public.agent_public_conversation_facts(v.id)->>'companyName' AS company_name,
   EXISTS(SELECT 1 FROM agent_operations o WHERE o.conversation_id=v.id AND o.thread_id=v.thread_id AND o.state='proposed' AND o.name ~ '^(email|whatsapp|linkedin)\\.(initial|reply|follow_up|invitation|manual_link)$') AS draft_pending,
   (SELECT h->>'direction' FROM jsonb_array_elements(v.history) h ORDER BY h->>'at' DESC,h->>'id' DESC LIMIT 1) AS last_message_direction
   FROM agent_conversations v JOIN contacts person ON person.id=v.contact_id AND person.organization_id=v.organization_id
   WHERE v.thread_id=$1 AND v.organization_id=$2 AND v.owner_user_id=$3`, [t.id, t.organization_id, t.owner_user_id])
    ).rows;
    conversations = conversations.map(person => ({ ...person, ...people.find(value => value.id === person.id) }));
    if (!(await c.query("SELECT to_regclass('public.agent_conversation_channels') IS NOT NULL AS installed")).rows[0]?.installed) {
        return conversations;
    }
    const routes = (
        await c.query(`SELECT r.*,b.service_account_id,b.platform,(SELECT jsonb_array_length(p.bindings) FROM agent_channel_policies p WHERE p.thread_id=r.thread_id) AS expected_routes,(r.history_complete AND r.history_observed_at BETWEEN ${businessSql}-interval '5 minutes' AND ${businessSql}) AS history_fresh,(public.agent_channel_proposal_permitted(r.id,'initial') OR public.agent_channel_proposal_permitted(r.id,'reply') OR public.agent_channel_proposal_permitted(r.id,'follow_up')) AS route_ready FROM agent_conversation_channels r JOIN communication_bindings b ON b.id=r.binding_id WHERE r.thread_id=$1 ORDER BY r.channel,r.id`, [t.id])
    ).rows;
    return conversations.map(person => {
        const selected = routes.filter(r => r.conversation_id === person.id);
        const observations = selected.map(r => (
            r.history_observed_at ? new Date(r.history_observed_at).getTime() : NaN
        ));
        // This projection reports the oldest coverage separately; the combined body keeps its
        // latest verified observation so messages arriving between account scans stay valid.
        const coverage = selected.length ? {
            history_coverage_observed_at: observations.every(Number.isFinite)
                ? new Date(Math.min(...observations)).toISOString()
                : null,
            history_coverage_fresh: selected.length === Number(selected[0].expected_routes)
                && selected.every(r => r.history_fresh === true),
        } : {};

        return {
            ...person,
            ...coverage,
            channels: selected.map(r => ({
                id: r.id as string,
                channel: r.channel as 'email' | 'whatsapp' | 'linkedin',
                state: person.phase !== 'active' ? person.phase as string
                    : !r.history_complete ? 'waiting_history'
                    : r.route_ready ? 'ready'
                    : r.cold_cancelled_at ? 'reply_received'
                    : 'waiting',
                recipient: r.recipient_value as string,
                bindingId: r.binding_id as string,
                senderLabel: [r.channel, r.platform, r.service_account_id].join(' · '),
                nextAllowedAt: r.next_allowed_at ? new Date(r.next_allowed_at).toISOString() : null,
                historyComplete: r.history_complete as boolean,
                historyFresh: r.history_fresh === true,
                historyObservedAt: r.history_observed_at ? new Date(r.history_observed_at).toISOString() : null,
            })),
        };
    });
}

export async function projectAgentInvitationExecutionProgress<T extends Record<string, unknown>>(
    c: Pick<PoolClient, 'query'>,
    t: AgentThread,
    people: T[],
): Promise<T[]> {
    if (!(await c.query("SELECT to_regclass('public.agent_linkedin_relationships') IS NOT NULL AS installed")).rows[0]?.installed) {
        return people;
    }
    const relations = (await c.query('SELECT * FROM agent_linkedin_relationships WHERE thread_id=$1', [t.id])).rows,
        actions = (await c.query('SELECT DISTINCT ON(route_id) route_id,state FROM agent_linkedin_invitations WHERE thread_id=$1 ORDER BY route_id,created_at DESC,operation_id', [t.id])).rows;

    return people.map(person => ({
        ...person,
        ...(Array.isArray(person.channels) ? {
            channels: person.channels.map((route: Record<string, unknown>) => {
                const r = relations.find(r => r.route_id === route.id),
                    a = actions.find(a => a.route_id === route.id);
                return {
                    ...route,
                    ...(r ? {
                        relationship: {
                            status: r.status,
                            canMessage: r.can_message,
                            observedAt: new Date(r.observed_at).toISOString(),
                        },
                    } : {}),
                    ...(a ? { invitationState: a.state } : {}),
                };
            }),
        } : {}),
    }));
}
