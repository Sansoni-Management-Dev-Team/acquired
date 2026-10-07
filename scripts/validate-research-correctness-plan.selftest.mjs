import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlan, validatePlan } from './validate-research-correctness-plan.mjs';

test('current local verification record is structurally complete', () => {
  assert.deepEqual(validatePlan(loadPlan()), []);
  assert.deepEqual(validatePlan(loadPlan(), { requireVerified: true }), []);
  const pending = loadPlan();
  pending.register.findings[0].status = 'in_progress';
  pending.register.investigation_intake[0].status = 'open';
  assert.ok(validatePlan(pending, { requireVerified: true }).some((e) => e.includes('not verified')));
  assert.ok(validatePlan(pending, { requireVerified: true }).some((e) => e.includes('investigation open')));
});

test('cannot silently drop a finding or its generalization proof obligation', () => {
  const missingFinding = loadPlan();
  missingFinding.register.findings.shift();
  assert.ok(validatePlan(missingFinding).some((e) => e.includes('Missing original finding RC-01')));
  const missingScenario = loadPlan();
  missingScenario.scenarios = missingScenario.scenarios.filter((s) => s.id !== 'RC-01-generalization');
  assert.ok(validatePlan(missingScenario).some((e) => e.includes('RC-01: requires exactly three')));
});

test('closure requires proof and independent executable evidence, not a status edit', () => {
  const plan = loadPlan();
  const f = plan.register.findings[0];
  f.status = 'verified';
  f.verification = null;
  assert.ok(validatePlan(plan).some((e) => e.includes('verified without proof')));
  f.verification = { finding_id: f.id, scenarios: [], decision_records: [] };
  assert.ok(validatePlan(plan).some((e) => e.includes('missing verified scenario proof')));
  assert.ok(validatePlan(plan).some((e) => e.includes('unresolved/unrecorded decision D-01')));
});

test('rejects cyclic dependencies and untraceable completeness fields', () => {
  const plan = loadPlan();
  plan.register.findings[0].depends_on = ['RC-02'];
  plan.register.findings[1].depends_on = ['RC-01'];
  plan.catalogue.fields[0].finding_ids = ['RC-99'];
  const errors = validatePlan(plan);
  assert.ok(errors.some((e) => e.includes('Dependency cycle')));
  assert.ok(errors.some((e) => e.includes('ABN: missing completeness traceability')));
});

test('resolved decisions and investigations require a substantive record', () => {
  const plan = loadPlan();
  plan.decisions[0].status = 'resolved';
  plan.decisions[0].choice = null;
  plan.register.investigation_intake[0].status = 'resolved';
  plan.register.investigation_intake[0].resolution = null;
  const errors = validatePlan(plan);
  assert.ok(errors.some((e) => e.includes('resolution lacks')));
  assert.ok(errors.some((e) => e.includes('missing investigation resolution')));
});

test('verified metadata cannot use missing, absolute, escaped artifacts or failed commands', () => {
  for (const artifact of ['missing-proof.log', '/tmp/proof.log', '../proof.log']) {
    const plan = loadPlan();
    plan.register.findings[0].verification.scenarios[0].artifact = artifact;
    assert.ok(validatePlan(plan).some((e) => e.includes('existing test file and artifact')));
  }
  const failed = loadPlan();
  failed.register.findings[0].verification.scenarios[0].exit_code = 1;
  assert.ok(validatePlan(failed).some((e) => e.includes('requires successful command')));
});
