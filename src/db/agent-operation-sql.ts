import {
  AGENT_LEGACY_EMAIL_OPERATION_NAMES,
  AGENT_CHANNEL_MESSAGE_OPERATION_NAMES,
  AGENT_NATIVE_DISPATCH_OPERATION_NAMES,
} from "@/domain/agent-operation-classifications";

// Only fixed source-controlled operation names enter these SQL fragments.
// Values supplied by callers remain ordinary query parameters at every use.
const sqlNames = (names: readonly string[]) =>
  names.map((name) => `'${name}'`).join(",");

export const agentLegacyEmailSqlNames = sqlNames(
  AGENT_LEGACY_EMAIL_OPERATION_NAMES,
);
export const agentChannelMessageSqlNames = sqlNames(
  AGENT_CHANNEL_MESSAGE_OPERATION_NAMES,
);
export const agentNativeDispatchSqlNames = sqlNames(
  AGENT_NATIVE_DISPATCH_OPERATION_NAMES,
);
