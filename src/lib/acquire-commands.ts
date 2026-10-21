import { AcquisitionRepository } from '@/db/acquisition-repository';
import { ResearchRepository } from '@/db/research-repository';
import { createAcquireCommands,AcquireCommandError,type AcquireActor } from '@/domain/acquire-commands';
import {CompanyIdentityStore,CompanyIdentityReviewError} from '@/db/company-identity-store';
import { assertOrganizationActor } from './organization-access';
async function identityCommand<T>(actor:AcquireActor,work:(store:CompanyIdentityStore)=>Promise<T>):Promise<T>{
 try{const {requireDb}=await import('@/db/client');return await work(CompanyIdentityStore.usingDrizzle(requireDb(),actor));}
 catch(cause){if(cause instanceof CompanyIdentityReviewError)throw new AcquireCommandError(cause.message,cause.status);throw cause;}
}
export const acquireCommands=createAcquireCommands({
 assertMember:assertOrganizationActor,
 getMandate:(actor,id)=>new AcquisitionRepository(actor.organizationId).getMandate(id),
 listResearch:(actor,id)=>new ResearchRepository(actor.organizationId).listReview(id),
 updateMandate:(actor,id,brief,revision)=>new AcquisitionRepository(actor.organizationId).updateBrief(brief,actor.userId,id,revision),
 listCompanyIdentityReviews:(actor,id)=>identityCommand(actor,store=>store.list(id)),
 reconcileCompanyIdentities:(actor,id)=>identityCommand(actor,store=>store.reconcileDuplicates(id)),
 decideCompanyIdentity:(actor,id,decision)=>identityCommand(actor,store=>store.decide(id,decision)),
});
