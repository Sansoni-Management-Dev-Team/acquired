import { AcquisitionRepository } from '@/db/acquisition-repository';
import { ResearchRepository } from '@/db/research-repository';
import { createAcquireCommands } from '@/domain/acquire-commands';
import { assertOrganizationActor } from './organization-access';
export const acquireCommands=createAcquireCommands({
 assertMember:assertOrganizationActor,
 getMandate:(actor,id)=>new AcquisitionRepository(actor.organizationId).getMandate(id),
 listResearch:(actor,id)=>new ResearchRepository(actor.organizationId).listReview(id),
 updateMandate:(actor,id,brief,revision)=>new AcquisitionRepository(actor.organizationId).updateBrief(brief,actor.userId,id,revision),
});
