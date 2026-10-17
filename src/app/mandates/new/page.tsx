import { CachedMandateCreate } from "@/components/cached-mandate-pages";

export default function NewMandatePage() {
  return <CachedMandateCreate agentModeEnabled={process.env.AGENT_MODE_EXPLORATION_ENABLED === "true"} />;
}
