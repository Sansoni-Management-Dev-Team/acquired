import { CachedMandateCreate } from "@/components/cached-mandate-pages";

export default function NewMandatePage() {
  return <CachedMandateCreate nativeAgentEnabled={process.env.AGENT_DURABLE_STATE_ENABLED === "true" && process.env.AGENT_NATIVE_EXECUTION_ENABLED === "true"} agentModeEnabled={process.env.AGENT_MODE_EXPLORATION_ENABLED === "true"} />;
}
