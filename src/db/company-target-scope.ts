import{and,eq,or,sql}from'drizzle-orm';
import{targets}from'./schema';
/** Shared normal/agent company service scope. Canonical ownership supports
 * historical rows; an explicit same-organization membership authorizes reuse
 * without duplicating a target or treating another mandate's target as ours. */
export function companyTargetScope(organizationId:string,mandateId:string,targetId:string){return and(eq(targets.id,targetId),eq(targets.organizationId,organizationId),or(eq(targets.mandateId,mandateId),sql`EXISTS(SELECT 1 FROM public.mandate_targets mt WHERE mt.organization_id=${organizationId} AND mt.mandate_id=${mandateId}::uuid AND mt.target_id=${targets.id})`));}
