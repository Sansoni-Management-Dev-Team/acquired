import { and,eq } from 'drizzle-orm';
import { requireDb } from '@/db/client';
import { member } from '@/db/schema';
import { AcquireCommandError,type AcquireActor } from '@/domain/acquire-commands';
export async function assertOrganizationActor(actor:AcquireActor){
 const found=await requireDb().select({id:member.id}).from(member).where(and(eq(member.organizationId,actor.organizationId),eq(member.userId,actor.userId))).limit(1);
 if(!found.length)throw new AcquireCommandError('Organisation membership required',403);
}
