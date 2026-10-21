import type { PoolClient } from "pg";
import type { AgentThread } from "./agent-store";
import type { AgentConversationContext } from "@/lib/agent-conversation-engine";

type DecisionChannel = NonNullable<
  AgentConversationContext["channels"]
>[number];
type DecisionRoute = Pick<
  DecisionChannel,
  "id" | "channel" | "historyComplete" | "historyObservedAt" | "nextAllowedAt"
>;
type ChannelDecisionContext = Pick<AgentConversationContext, "channels">;
type QueryClient = Pick<PoolClient, "query">;

/** Project only the caller's already loaded routes on its same transaction.
 * Current SQL admission remains authoritative; this helper acquires no send authority. */
export async function projectAgentChannelDecisionContext(
  c: QueryClient,
  routes: readonly DecisionRoute[],
): Promise<ChannelDecisionContext> {
  if (!routes.length) return {};
  const channels: DecisionChannel[] = [];
  for (const r of routes) {
    const ready =
      (
        await c.query(
          "SELECT public.agent_channel_proposal_permitted($1::uuid,'initial') OR public.agent_channel_proposal_permitted($1::uuid,'reply') OR public.agent_channel_proposal_permitted($1::uuid,'follow_up') AS allowed",
          [r.id],
        )
      ).rows[0]?.allowed === true;
    channels.push({
      id: r.id,
      channel: r.channel,
      historyComplete: r.historyComplete,
      historyObservedAt: r.historyObservedAt,
      readiness: ready ? "ready" : "waiting",
      nextAllowedAt: r.nextAllowedAt,
    });
  }
  return { channels };
}

/** Relationship facts enrich the base channel projection; each allowed action
 * still comes from the unchanged protected SQL admission query. */
export async function projectAgentInvitationDecisionContext(
  c: QueryClient,
  t: AgentThread,
  row: Record<string, unknown>,
  base: ChannelDecisionContext,
): Promise<ChannelDecisionContext> {
  if (!Array.isArray(base.channels)) return base;
  const installed =
    (
      await c.query(
        "SELECT to_regclass('public.agent_linkedin_relationships') IS NOT NULL AS installed",
      )
    ).rows[0]?.installed === true;
  if (!installed) return base;
  const observations = (
    await c.query(
      "SELECT * FROM agent_linkedin_relationships WHERE conversation_id=$1 AND thread_id=$2",
      [row.id, t.id],
    )
  ).rows;
  const channels: DecisionChannel[] = [];
  for (const route of base.channels) {
    const saved = observations.find((r) => r.route_id === route.id),
      allowedActions: NonNullable<DecisionChannel["allowedActions"]> = [];
    for (const action of [
      "initial",
      "reply",
      "follow_up",
      ...(route.channel === "linkedin" ? ["invitation" as const] : []),
    ] as const)
      if (
        (
          await c.query(
            "SELECT public.agent_channel_proposal_permitted($1::uuid,$2) AS allowed",
            [route.id, action],
          )
        ).rows[0]?.allowed === true
      )
        allowedActions.push(action);
    channels.push({
      ...route,
      readiness: allowedActions.length ? "ready" : "waiting",
      allowedActions,
      ...(saved
        ? {
            relationship: {
              status: saved.status,
              canMessage: saved.can_message,
              observedAt: new Date(saved.observed_at).toISOString(),
            },
          }
        : {}),
    });
  }
  return { ...base, channels };
}
