import {z} from 'zod';
import type {AcquisitionBrief} from '@/domain/acquisition';
import type {BuyerProfile} from '@/domain/buyer-profile';

// Server-owned fictional identity. No organisation profile, private financial
// criterion or free-form mandate description is copied into demo outreach.
const profileSchema=z.object({
 publicProfileApproved:z.literal(true),senderName:z.literal('Alex Morgan'),
 about:z.string().trim().min(10).max(1500).refine(value=>/\bTEST DATA\b/i.test(value)&&/\bfictional\b/i.test(value),'Explicit fictional test buyer required'),
 signature:z.literal('Alex Morgan\nExample Acquisition Group'),
 operatingIntent:z.string().trim().min(10).max(500).optional(),callToAction:z.string().trim().min(5).max(240).optional(),
}).strict();
export const demoBuyerProfileStampSchema=z.object({version:z.literal(1),mandateId:z.string().uuid(),profile:profileSchema}).strict();
export type DemoBuyerProfileStamp=z.infer<typeof demoBuyerProfileStampSchema>;
function searchLabel(brief:AcquisitionBrief,key:'subsectors'|'geography',limit:number){
 const criterion=brief.criteria.find(row=>row.key===key);
 if(criterion?.state!=='specified'||/[<>]|https?:\/\/|www\.|@/i.test(criterion.value))return undefined;
 const clean=criterion.value.normalize('NFKC').replace(/\p{C}/gu,' ').replace(/[^\p{L}\p{N}\s,;&()/'.–—-]/gu,' ').replace(/\s+/g,' ').trim().slice(0,limit).trim().replace(/[.;,:]+$/,'').trim();
 return /\p{L}/u.test(clean)?clean:undefined;
}
/** Deterministic target-search context, never fabricated buyer credentials. */
export function buildDemoBuyerProfile(mandateId:string,brief:AcquisitionBrief):DemoBuyerProfileStamp{
 const sector=searchLabel(brief,'subsectors',240),geography=searchLabel(brief,'geography',100),place=geography?/^(?:national|nationwide|australia(?:[ -]wide)?|all australia)$/i.test(geography)?'across Australia':`in ${geography}`:'in Australia';
 return demoBuyerProfileStampSchema.parse({version:1,mandateId,profile:{
  publicProfileApproved:true,senderName:'Alex Morgan',signature:'Alex Morgan\nExample Acquisition Group',
  about:`TEST DATA — Example Acquisition Group is a fictional acquisition buyer for this demo. Its acquisition search focuses on ${sector||'businesses'} ${place}. This is a target search only, not a claim about existing operations, holdings, credentials or available funding. It seeks a confidential, non-binding exploratory discussion. This profile does not establish fees, funding availability or transaction terms.`,
  operatingIntent:'For testing only: explore whether a confidential acquisition discussion would be welcome, without commitments about transaction terms or outcomes.',
  callToAction:'Would you be open to a brief, confidential exploratory discussion?',
 }});
}
/** A saved stamp can be used only for its own immutable demo execution identity. */
export function resolveDemoBuyerProfile(input:{executionMode:string;demoId?:string|null;mandateId:string;provenance:unknown}):BuyerProfile|null{
 if(input.executionMode!=='demo'||input.demoId!==input.mandateId||!input.provenance||typeof input.provenance!=='object'||Array.isArray(input.provenance))return null;
 const parsed=demoBuyerProfileStampSchema.safeParse((input.provenance as Record<string,unknown>).demoBuyerProfile);
 return parsed.success&&parsed.data.mandateId===input.mandateId?parsed.data.profile:null;
}
