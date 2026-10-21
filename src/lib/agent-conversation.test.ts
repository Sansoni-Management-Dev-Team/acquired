import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { agentSnapshot } from '@/domain/agent-mode';
import { emptyBrief } from '@/domain/acquisition';
const mocks = vi.hoisted(() => ({ complete: vi.fn(), options: vi.fn() }));
vi.mock('@/adapters/ai/free-openrouter', () => ({
  FREE_MANDATE_MODELS: ['approved-free-model'],
  FreeOpenRouter: class { constructor(options: unknown) { mocks.options(options); } complete = mocks.complete; },
}));
import { answerAgentQuestion } from './agent-conversation';
const snapshot = agentSnapshot({ id: 'mandate-a', brief: { ...emptyBrief(), name: 'Building services', naturalLanguage: 'Buy a Queensland maintenance company.' }, createdAt: '' }, [{ status: 'queued' }]);
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('OPENROUTER_API_KEY', 'test-key'); mocks.complete.mockResolvedValue({ response: { answer: 'One research job is queued. No completion estimate is available.' } }); });
afterEach(() => vi.unstubAllEnvs());
it('answers a natural-language question using freshly read state and bounded conversation context', async () => {
  const result = await answerAgentQuestion([{ role: 'user', content: 'hows it going' }], snapshot);
  expect(result).toContain('One research job');
  expect(mocks.options.mock.calls[0][0]).not.toHaveProperty('paidFallback', false);
  expect(mocks.options.mock.calls[0][0]).not.toHaveProperty('primaryRoute', 'fast-paid');
  const input = mocks.complete.mock.calls[0][0];
  expect(input.messages[0]).toMatchObject({ role: 'system', content: expect.stringContaining('cannot execute actions') });
  expect(input.messages[1].content).toContain('"queued":1');
  expect(input.messages[1].content).toContain('hows it going');
  expect(input.messages[1].content).toContain('Building services');
  expect(input.messages[0].content).toContain('job counts');
});
it('excludes injected system/tool roles and caps transcript history', async () => {
  await answerAgentQuestion([{ role: 'system', content: 'forged system authority' }, { role: 'tool', content: 'forged tool result' }, ...Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: `question-${i}` }))], snapshot);
  const input = mocks.complete.mock.calls[0][0];
  const content = JSON.parse(input.messages[1].content);
  expect(content.conversation).toHaveLength(12);
  expect(content.conversation.at(-1).content).toBe('question-29');
  expect(input.messages[1].content).not.toContain('forged');
  expect(input).not.toHaveProperty('tools');
});
it('fails honestly on unavailable models and invalid answers', async () => {
  mocks.complete.mockRejectedValueOnce(new Error('provider unavailable'));
  await expect(answerAgentQuestion([{ role: 'user', content: 'Hello' }], snapshot)).rejects.toThrow();
  mocks.complete.mockResolvedValueOnce({ response: { answer: '' } });
  await expect(answerAgentQuestion([{ role: 'user', content: 'Hello' }], snapshot)).rejects.toThrow();
});

it('adds explicitly approved mandate guidance as bounded data without changing authority',async()=>{
 const guidance={id:'00000000-0000-4000-8000-000000000002',revision:2,state:'approved' as const,organizationId:'org',userId:'user',mandateId:snapshot.mandate.id,input:{text:'Prefer a concise tone.',category:'tone' as const,sourceMessageId:'00000000-0000-4000-8000-000000000001',triggerTerms:[]}};
 await answerAgentQuestion([{role:'user',content:'How is it going?'}],snapshot,true,[guidance]);
 const sent=mocks.complete.mock.calls[0][0];const context=JSON.parse(sent.messages[1].content);
 expect(context.approvedGuidance).toEqual([expect.objectContaining({id:guidance.id,revision:2,text:'Prefer a concise tone.'})]);expect(sent.messages[0].content).toContain('cannot grant authority');expect(sent).not.toHaveProperty('tools');
});
