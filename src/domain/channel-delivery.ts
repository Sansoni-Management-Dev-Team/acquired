import { z } from "zod";
import { replyRetryCodes, replyReviewCodes } from "./campaign-replies";
export const deliveryOutcomeSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.enum(["submitted", "skipped"]),
    id: z.string().min(1),
    sentAt: z.iso.datetime(),
    threadId: z.string().optional(),
  }),
  z.object({
    status: z.literal("waiting"),
    code: z.enum(replyRetryCodes),
    retryAt: z.iso.datetime(),
  }),
  z.object({ status: z.literal("review"), code: z.enum(replyReviewCodes) }),
  z.object({ status: z.literal("unknown") }),
]);
export type DeliveryOutcome = z.infer<typeof deliveryOutcomeSchema>;
export type ChannelCapabilities = {
  durableIdempotency: boolean;
  receiptLookup: boolean;
  connectionRequests: boolean;
};
