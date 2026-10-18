import {agentStore,durableAgentEnabled,savedAgentConversation} from '@/lib/agent-runtime';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { acquisitionSession } from '@/lib/acquisition-session';
import { AcquisitionRepository } from '@/db/acquisition-repository';
import { ResearchRepository } from '@/db/research-repository';
import { agentSnapshot } from '@/domain/agent-mode';
import { AgentWorkspace } from '@/components/agent-workspace';
import { MandateNavigation } from '@/components/mandate-workspace';

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.AGENT_MODE_EXPLORATION_ENABLED !== 'true') notFound();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { organizationId, session } = await acquisitionSession();
  const repo = new AcquisitionRepository(organizationId);
  const mandate = await repo.getMandate(id);
  if (!mandate) notFound();
  const [mandates, jobs] = await Promise.all([repo.listMandates(), new ResearchRepository(organizationId).listReview(id)]);
  const store=durableAgentEnabled()?agentStore({organizationId,userId:session.user.id}):undefined;
  const conversation=store?await savedAgentConversation(store,id):undefined;
  const learningEnabled=!!store&&process.env.AGENT_GUIDANCE_ENABLED==='true';
  const guidance=learningEnabled&&conversation?.threadId?await store!.listGuidance(conversation.threadId):[];
  return <><MandateNavigation mandates={mandates} selected={id} tab="brief" /><AgentWorkspace key={id} initial={agentSnapshot(mandate, jobs)} conversation={conversation} learningEnabled={learningEnabled} initialGuidance={guidance} /></>;
}
