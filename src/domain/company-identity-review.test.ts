import { describe, expect, it } from 'vitest';
import { canAdoptCompanyIdentityReview, companyIdentityDecisionSchema, companyIdentityReviewSchema } from './company-identity-review';
const id='11111111-1111-4111-8111-111111111111';
describe('company identity review contract',()=>{
 it('requires an explicit selected existing target only for adoption',()=>{
 const base={requestKey:id,reviewId:id,expectedRevision:1,previewDigest:'a'.repeat(64)};
 expect(companyIdentityDecisionSchema.safeParse({...base,decision:'adopt'}).success).toBe(false);
 expect(companyIdentityDecisionSchema.safeParse({...base,decision:'adopt',selectedTargetId:id}).success).toBe(true);
 expect(companyIdentityDecisionSchema.safeParse({...base,decision:'skip',selectedTargetId:id}).success).toBe(false);
 });
 it('allows adoption only for consistent duplicate identities',()=>{
 expect(canAdoptCompanyIdentityReview('consistent_existing_duplicates')).toBe(true);
 expect(canAdoptCompanyIdentityReview('conflicting_identifiers')).toBe(false);
 expect(canAdoptCompanyIdentityReview('source_changed')).toBe(false);
 });
 it('rejects hidden overlarge candidate sets and unknown fields',()=>{
 const candidate={targetId:id,sourceRevision:'123',companyName:'Example',domain:'example.test',savedPeopleCount:0,mandateCount:1};
 const review={reviewId:id,revision:1,previewDigest:'b'.repeat(64),reason:'consistent_existing_duplicates',source:{observationId:id,jobId:id,mandateId:id,companyName:'Example',domain:'example.test',observedAt:'2026-10-18T00:00:00.000Z',sourceUrl:'https://example.test'},candidates:[candidate]};
 expect(companyIdentityReviewSchema.safeParse(review).success).toBe(true);
 expect(companyIdentityReviewSchema.safeParse({...review,candidates:Array(51).fill(candidate)}).success).toBe(false);
 expect(companyIdentityReviewSchema.safeParse({...review,canAdopt:true}).success).toBe(false);
 });
});
