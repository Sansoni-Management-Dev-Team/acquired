import{ReplyProcessingPendingError}from'../../core/src/history-pending';
import type{SqlClient}from'./webhook-repository';
/** Caller retains authenticated original tenant's reply-barrier lock. This is
 * only a typed rejection; the existing dispatch barrier still runs when clear. */
export async function assertHistoryRepliesProcessed(c:SqlClient,applicationId:string,tenantId:string){
 const r=await c.query(`SELECT (EXISTS(SELECT 1 FROM communications.webhook_receipt_routes r JOIN communications.webhook_inbox w ON w.id=r.webhook_inbox_id WHERE r.application_id=$1 AND r.tenant_id=$2 AND w.state<>'processed') OR EXISTS(SELECT 1 FROM communications.webhook_inbox w WHERE NOT EXISTS(SELECT 1 FROM communications.webhook_receipt_routes r WHERE r.webhook_inbox_id=w.id) AND EXISTS(SELECT 1 FROM communications.connection_generations g WHERE g.application_id=$1 AND g.tenant_id=$2 AND g.integration_id=w.integration_id AND g.backend=w.backend)) OR EXISTS(SELECT 1 FROM communications.event_outbox o WHERE o.application_id=$1 AND o.tenant_id=$2 AND o.state<>'acknowledged') OR EXISTS(SELECT 1 FROM communications.reply_review_latches l WHERE l.application_id=$1 AND l.tenant_id=$2 AND l.resolved_at IS NULL)) AS history_replies_pending`,[applicationId,tenantId]);
 if(r.rows.length!==1||typeof r.rows[0].history_replies_pending!=='boolean')throw Error('History readiness unavailable');
 if(r.rows[0].history_replies_pending)throw new ReplyProcessingPendingError();
}
