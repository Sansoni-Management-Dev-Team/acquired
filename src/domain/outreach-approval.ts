export function enrolmentStateAfterApproval(messageStates: string[]) {
  return messageStates.length > 0 && messageStates.every((state) => state === "approved") ? "manual_confirmation" as const : "awaiting_approval" as const;
}
