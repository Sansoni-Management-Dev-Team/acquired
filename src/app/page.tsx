import { CachedMandateCreate } from "@/components/cached-mandate-pages";
import { connection } from 'next/server';

export default async function Home() {
  await connection();
  return <CachedMandateCreate sharedWorkflowEnabled={process.env.ACQUISITION_WORKFLOW_ENABLED === "true"} nativeAgentEnabled={process.env.AGENT_DURABLE_STATE_ENABLED === "true" && process.env.AGENT_NATIVE_EXECUTION_ENABLED === "true"} agentModeEnabled={process.env.AGENT_MODE_EXPLORATION_ENABLED === "true"} />;
}
