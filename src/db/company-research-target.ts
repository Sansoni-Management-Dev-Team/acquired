import {loadAcceptedCompanyObservations} from './company-observation-read-model';
import {applyCompanyObservationToTargetRecord,type CompanyProjectionTargetRecord} from '@/domain/company-membership-projection';
import type {ResearchPersistenceDatabase} from '@/lib/research-persistence-lock';
/** New research explicitly reads its accepted mandate source. Historical jobs
 * retain their saved source contract and never silently opt into another path. */
export async function companyResearchTarget(database:ResearchPersistenceDatabase,scope:{organizationId:string;mandateId:string},target:CompanyProjectionTargetRecord,identityPolicyVersion?:1){
 if(identityPolicyVersion!==1)return{target,observation:null};
 const observation=(await loadAcceptedCompanyObservations(database,scope.organizationId,scope.mandateId,[target.id])).get(target.id);
 if(!observation)throw Error('The current accepted company source is unavailable');
 return{target:applyCompanyObservationToTargetRecord(target,observation),observation};
}
