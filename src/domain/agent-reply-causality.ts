import{z}from'zod';
const historyId=z.string().min(1).max(300),revision=z.string().regex(/^[a-f0-9]{64}$/);
/** Server-owned snapshot, never accepted as part of a model/client draft. SQL
 * validates capture at insertion and keeps it immutable through reconciliation. */
export const agentReplyCausalitySchema=z.object({version:z.literal(1),answeredInboundHistoryId:historyId,consumedInboundHistoryIds:z.array(historyId).min(1).max(200),historyRevision:revision,routeHistoryRevision:revision,inboundAt:z.string().datetime({offset:true})}).strict().refine(p=>new Set(p.consumedInboundHistoryIds).size===p.consumedInboundHistoryIds.length&&p.consumedInboundHistoryIds.includes(p.answeredInboundHistoryId),'Exact unique consumed person turn required');
