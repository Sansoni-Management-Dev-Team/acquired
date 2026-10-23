import { z } from 'zod';

const uuid = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).max(1000);
export const companyIdentityReviewReasonSchema = z.enum([
  'consistent_existing_duplicates', 'conflicting_identifiers', 'source_changed',
]);
export type CompanyIdentityReviewReason = z.infer<typeof companyIdentityReviewReasonSchema>;
export function canAdoptCompanyIdentityReview(reason: CompanyIdentityReviewReason): boolean {
  return reason === 'consistent_existing_duplicates';
}
export const companyIdentityReviewSchema = z.object({
  reviewId: uuid,
  revision: z.number().int().positive(),
  previewDigest: digest,
  source: z.object({
    observationId: uuid, jobId: uuid, mandateId: uuid,
    companyName: text, firmableId: text.optional(), domain: text,
    abn: text.optional(), observedAt: z.string().datetime({ offset: true }),
    sourceUrl: z.string().url().max(4000),
  }).strict(),
  candidates: z.array(z.object({
    targetId: uuid, sourceRevision: z.string().min(1).max(200),
    companyName: text, domain: text, firmableId: text.optional(), abn: text.optional(),
    savedPeopleCount: z.number().int().nonnegative(),
    mandateCount: z.number().int().nonnegative(),
    workflowSummary: z.string().max(1000).optional(),
  }).strict()).max(50),
  reason: companyIdentityReviewReasonSchema,
}).strict();
export type CompanyIdentityReview = z.infer<typeof companyIdentityReviewSchema>;
export const companyIdentityDecisionBaseShape = {
  requestKey: uuid, reviewId: uuid, expectedRevision: z.number().int().positive(),
  previewDigest: digest,
};
export const companyIdentityDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ ...companyIdentityDecisionBaseShape, decision: z.literal('adopt'), selectedTargetId: uuid }).strict(),
  z.object({ ...companyIdentityDecisionBaseShape, decision: z.literal('skip') }).strict(),
]);
export type CompanyIdentityDecision = z.infer<typeof companyIdentityDecisionSchema>;
export const companyIdentityDecisionReceiptSchema = z.discriminatedUnion('status', [
  z.object({ reviewId: uuid, status: z.literal('adopted'), targetId: uuid }).strict(),
  z.object({ reviewId: uuid, status: z.literal('skipped') }).strict(),
]);
export type CompanyIdentityDecisionReceipt = z.infer<typeof companyIdentityDecisionReceiptSchema>;
