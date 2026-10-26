import {agentStore,agentPool,nativeAgentEnabled,durableAgentEnabled,savedAgentConversation} from '@/lib/agent-runtime';
import {readInitialMandateResearch} from '@/lib/agent-initial-research';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { acquisitionSession } from '@/lib/acquisition-session';
import { AcquisitionRepository } from '@/db/acquisition-repository';
import { ResearchRepository } from '@/db/research-repository';
import { agentSnapshot } from '@/domain/agent-mode';
import { AgentWorkspace } from '@/components/agent-workspace';
import { MandateNavigation } from '@/components/mandate-workspace';
import {AgentMandatePreparation} from '@/components/agent-mandate-preparation';
import {mandateCacheScope} from '@/lib/mandate-cache-scope';

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.AGENT_MODE_EXPLORATION_ENABLED !== 'true') notFound();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { organizationId, session } = await acquisitionSession();
  const repo = new AcquisitionRepository(organizationId);
  const mandate = await repo.getMandate(id);
  // Pending drafts live only in this browser, so the server cannot distinguish
  // them from missing IDs. This generic shell returns no saved data; the client
  // requires matching local owner intent and explicit Start before admission.
  if (!mandate) return <AgentMandatePreparation key={`${id}:${mandateCacheScope(session)}`} mandateId={id} ownerScope={mandateCacheScope(session)} />;
  const [mandates, jobs] = await Promise.all([repo.listMandates(), new ResearchRepository(organizationId).listReview(id)]);
  const store=durableAgentEnabled()?agentStore({organizationId,userId:session.user.id}):undefined;
  const conversation=store?await savedAgentConversation(store,id):undefined;
  const initialResearch=nativeAgentEnabled()?await readInitialMandateResearch(agentPool(),{organizationId,userId:session.user.id},id):undefined;
  const learningEnabled=!!store&&process.env.AGENT_GUIDANCE_ENABLED==='true';
  const guidance=learningEnabled&&conversation?.threadId?await store!.listGuidance(conversation.threadId):[];
  return <><MandateNavigation mandates={mandates} selected={id} tab="agent" /><AgentWorkspace key={id} initial={agentSnapshot(mandate, jobs,initialResearch)} conversation={conversation} learningEnabled={learningEnabled} initialGuidance={guidance} /></>;
}
