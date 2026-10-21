import{z}from'zod';
export const resolveChannelReviewSchema=z.object({requestKey:z.string().uuid(),bindingId:z.string().uuid(),serviceEventId:z.string().min(1).max(200),expectedFingerprint:z.string().regex(/^[a-f0-9]{64}$/),createdAt:z.iso.datetime(),decision:z.literal('reviewed_unrelated'),reason:z.string().trim().min(20).max(2000)}).strict();
export type ResolveChannelReviewInput=z.infer<typeof resolveChannelReviewSchema>;
export type ChannelReviewItem={bindingId:string;serviceEventId:string;channel:string;platform:string;accountLabel:string;code:string;createdAt:string;occurredAt:string;receiptFingerprint:string;receiptResult:string;fingerprintVersion:string;canReviewUnrelated:boolean;provenance?:import('../lib/communications-retained-outbound').UntrackedOutboundProof};
