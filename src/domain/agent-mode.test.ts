import { describe, expect, it } from 'vitest';
import { emptyBrief } from './acquisition';
import { agentSnapshot, researchPlan } from './agent-mode';
const mandate = { id: 'mandate-a', brief: { ...emptyBrief(), name: 'Industrial services', naturalLanguage: 'Industrial maintenance businesses in Queensland.' }, createdAt: '2026-10-16T00:00:00Z' };
describe('research-only agent exploration', () => {
  it('requires a review before saving or starting work and never grants outreach authority', () => {
    const plan = researchPlan(mandate.brief);
    expect(plan.scope).toBe('research-only');
    expect(plan.outreachEnabled).toBe(false);
    expect(plan.bookingEnabled).toBe(false);
    expect(plan.requiresReview).toBe(true);
    expect(plan.description).toBe(mandate.brief.naturalLanguage);
  });
  it('retains unknown criteria instead of inventing a complete mandate', () => {
    expect(researchPlan(mandate.brief).unconfirmedCriteria).toHaveLength(mandate.brief.criteria.length);
  });
  it('distinguishes active, failed, partial and completed jobs without calling them meetings or qualified targets', () => {
    const snapshot = agentSnapshot(mandate, [{ status: 'queued' }, { status: 'extracting' }, { status: 'complete' }, { status: 'partial' }, { status: 'failed' }]);
    expect(snapshot.research).toMatchObject({ total: 5, queued: 1, active: 1, complete: 1, needsReview: 2 });
  });
  it('does not report stale nonterminal jobs as actively progressing', () => {
    const snapshot = agentSnapshot(mandate, [{ status: 'extracting', updatedAt: '2020-01-01T00:00:00Z' }]);
    expect(snapshot.research).toMatchObject({ active: 0, needsReview: 1 });
  });
  it('keeps the real saved brief and research-only scope in the model snapshot', () => {
    const snapshot = agentSnapshot(mandate, []);
    expect(snapshot.mandate.description).toBe(mandate.brief.naturalLanguage);
    expect(snapshot.scope).toBe('research-only');
    expect(snapshot.research.total).toBe(0);
  });
});

it('distinguishes a queued job from executing work and includes its saved progress message', () => {
  const snapshot = agentSnapshot(mandate, [{ status: 'queued', updatedAt: new Date(), message: 'Queued', pages: 0, modelCalls: 0 }]);
  expect(snapshot.research).toMatchObject({ queued: 1, active: 0 });
  expect(snapshot.jobs[0]).toMatchObject({ status: 'queued', message: 'Queued', pages: 0, modelCalls: 0 });
});

it.each(['Test mandate c3c550f0','Test mandate c3c550f0-18b4-4908-8227-a1aecec6e001'])('adds factual display metadata only for the exact fixture name %s',name=>{
 const saved=structuredClone(mandate);saved.brief.name=name;const text='Cybersecurity services; IT consulting and support';saved.brief.criteria.find(c=>c.key==='subsectors')!.value=text;
 const before=structuredClone(saved),snapshot=agentSnapshot(saved,[]);
 expect(snapshot.mandate).toMatchObject({id:saved.id,name,displayName:text});expect(saved).toEqual(before);
});
it.each(['Industrial services','Test mandate customer-name','My Test mandate c3c550f0','Test mandate c3c550f0 extra'])('preserves custom names without inferred display metadata (%s)',name=>{
 const saved=structuredClone(mandate);saved.brief.name=name;saved.brief.criteria.find(c=>c.key==='subsectors')!.value='Cybersecurity';const snapshot=agentSnapshot(saved,[]);
 expect(snapshot.mandate.name).toBe(name);expect(snapshot.mandate).not.toHaveProperty('displayName');
});
it('falls back to the canonical fixture name when its subsector text is empty',()=>{
 const saved=structuredClone(mandate);saved.brief.name='Test mandate c3c550f0';saved.brief.criteria.find(c=>c.key==='subsectors')!.value='  ';
 expect(agentSnapshot(saved,[]).mandate).not.toHaveProperty('displayName');expect(agentSnapshot(saved,[]).mandate.name).toBe(saved.brief.name);
});
