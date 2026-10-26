import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {emptyBrief} from '@/domain/acquisition';
const m=vi.hoisted(()=>({session:vi.fn(),get:vi.fn(),list:vi.fn(),review:vi.fn(),repository:vi.fn(),store:vi.fn(),conversation:vi.fn(),initial:vi.fn()}));
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('not-found');}}));
vi.mock('@/lib/acquisition-session',()=>({acquisitionSession:m.session}));
vi.mock('@/db/acquisition-repository',()=>({AcquisitionRepository:class{constructor(org:string){m.repository(org);}getMandate=m.get;listMandates=m.list;}}));
vi.mock('@/db/research-repository',()=>({ResearchRepository:class{listReview=m.review;}}));
vi.mock('@/lib/agent-runtime',()=>({agentStore:m.store,agentPool:()=>({}),nativeAgentEnabled:()=>false,durableAgentEnabled:()=>false,savedAgentConversation:m.conversation}));
vi.mock('@/lib/agent-initial-research',()=>({readInitialMandateResearch:m.initial}));
vi.mock('@/components/agent-workspace',()=>({AgentWorkspace:()=>null}));
vi.mock('@/components/mandate-workspace',()=>({MandateNavigation:()=>null}));
vi.mock('@/components/agent-mandate-preparation',()=>({AgentMandatePreparation:()=>null}));
import AgentPage from './page';
import {AgentWorkspace} from '@/components/agent-workspace';
import {AgentMandatePreparation} from '@/components/agent-mandate-preparation';
const id='10000000-0000-4000-8000-000000000001';
const session={user:{id:'owner'},session:{id:'session',activeOrganizationId:'org'}};
const open=(mandateId=id)=>AgentPage({params:Promise.resolve({id:mandateId})});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('AGENT_MODE_EXPLORATION_ENABLED','true');m.session.mockResolvedValue({organizationId:'org',session});m.get.mockResolvedValue(undefined);m.list.mockResolvedValue([]);m.review.mockResolvedValue([]);});
afterEach(()=>vi.unstubAllEnvs());
it('serves only the generic preparation shell for a missing org-scoped row after authenticating',async()=>{
 const page=await open();expect(page.type).toBe(AgentMandatePreparation);expect(page.props).toEqual({mandateId:id,ownerScope:'["owner","org","session"]'});
 expect(m.repository).toHaveBeenCalledExactlyOnceWith('org');expect(m.get).toHaveBeenCalledExactlyOnceWith(id);expect(m.list).not.toHaveBeenCalled();expect(m.review).not.toHaveBeenCalled();expect(m.store).not.toHaveBeenCalled();expect(m.initial).not.toHaveBeenCalled();
});
it('retains feature and UUID guards before authentication or repository reads',async()=>{
 vi.stubEnv('AGENT_MODE_EXPLORATION_ENABLED','false');await expect(open()).rejects.toThrow('not-found');vi.stubEnv('AGENT_MODE_EXPLORATION_ENABLED','true');await expect(open('invalid')).rejects.toThrow('not-found');expect(m.session).not.toHaveBeenCalled();expect(m.repository).not.toHaveBeenCalled();
});
it('retains authentication before even serving preparation',async()=>{
 m.session.mockRejectedValue(Error('sign-in'));await expect(open()).rejects.toThrow('sign-in');expect(m.repository).not.toHaveBeenCalled();
});
it('keeps the existing saved mandate workspace path',async()=>{
 m.get.mockResolvedValue({id,brief:emptyBrief(),createdAt:'2026-10-26'});const page=await open();const children=React.Children.toArray(page.props.children) as React.ReactElement[];
 expect(children.some(child=>child.type===AgentWorkspace)).toBe(true);expect(children.some(child=>child.type===AgentMandatePreparation)).toBe(false);expect(m.list).toHaveBeenCalledOnce();expect(m.review).toHaveBeenCalledExactlyOnceWith(id);
});
