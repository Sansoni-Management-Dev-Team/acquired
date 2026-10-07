import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const levels = ['regression', 'generalization', 'integration'];
const statuses = ['planned', 'in_progress', 'implemented', 'verified'];
const nonempty = (v) => typeof v === 'string' && v.trim().length > 0;

export function validatePlan(plan, { requireVerified = false, root = projectRoot } = {}) {
  const errors = [];
  const check = (ok, message) => { if (!ok) errors.push(message); };
  const { register, scenarios, catalogue, decisions } = plan;
  const findings = register.findings;
  const ids = new Set(findings.map((f) => f.id));
  const scenarioIds = new Set(scenarios.map((s) => s.id));
  check(ids.size === findings.length, 'Duplicate finding IDs');
  check(scenarioIds.size === scenarios.length, 'Duplicate scenario IDs');
  for (let i = 1; i <= 18; i++) check(ids.has(`RC-${String(i).padStart(2, '0')}`), `Missing original finding RC-${String(i).padStart(2, '0')}`);
  const artifactExists = (path) => {
    if (!nonempty(path) || isAbsolute(path)) return false;
    const target = resolve(root, path);
    return !relative(root, target).startsWith('..') && existsSync(target);
  };
  for (const f of findings) {
    check(/^RC-\d{2,}$/.test(f.id), `Invalid finding ID ${f.id}`);
    check(statuses.includes(f.status), `${f.id}: invalid status`);
    for (const key of ['title', 'root_cause', 'classification', 'incident_evidence', 'acceptance', 'boundary']) check(nonempty(f[key]), `${f.id}: missing ${key}`);
    check(f.source_references.length > 0, `${f.id}: missing source references`);
    check(f.depends_on.every((id) => ids.has(id) && id !== f.id), `${f.id}: invalid dependency`);
    const linked = scenarios.filter((s) => s.finding === f.id);
    check(linked.length === 3 && levels.every((level) => linked.filter((s) => s.level === level).length === 1), `${f.id}: requires exactly three scenario levels`);
    check(f.scenario_ids.length === 3 && linked.every((s) => f.scenario_ids.includes(s.id)), `${f.id}: scenario references mismatch`);
    if (requireVerified) check(f.status === 'verified', `${f.id}: not verified`);
    if (f.status !== 'verified') continue;
    const proof = f.verification;
    check(Boolean(proof), `${f.id}: verified without proof`);
    if (!proof) continue;
    check(proof.finding_id === f.id, `${f.id}: proof belongs to another finding`);
    for (const key of ['commit', 'reviewer', 'verified_at', 'reproduction_before', 'result_after']) check(nonempty(proof[key]), `${f.id}: missing proof ${key}`);
    check(Array.isArray(proof.remaining_limitations), `${f.id}: missing limitation review`);
    for (const s of linked) {
      const evidence = proof.scenarios?.filter((entry) => entry.scenario_id === s.id) ?? [];
      check(s.status === 'verified' && evidence.length === 1, `${s.id}: missing verified scenario proof`);
      if (evidence.length !== 1) continue;
      const e = evidence[0];
      check(nonempty(e.command) && e.exit_code === 0 && artifactExists(e.test_file) && artifactExists(e.artifact), `${s.id}: requires successful command, existing test file and artifact`);
      check(s.test_file === e.test_file && s.command === e.command && s.evidence === e.artifact, `${s.id}: scenario and verification metadata disagree`);
    }
    for (const d of decisions.filter((d) => d.finding_ids.includes(f.id))) {
      check(d.status === 'resolved' && proof.decision_records?.includes(d.id), `${f.id}: unresolved/unrecorded decision ${d.id}`);
    }
    check(f.depends_on.every((id) => findings.find((d) => d.id === id)?.status === 'verified'), `${f.id}: dependency not verified`);
  }
  // A cyclic graph cannot supply a valid implementation order.
  const visited = new Set();
  const active = new Set();
  function visit(id) {
    if (active.has(id)) { errors.push(`Dependency cycle at ${id}`); return; }
    if (visited.has(id)) return;
    active.add(id);
    for (const dep of findings.find((f) => f.id === id)?.depends_on ?? []) visit(dep);
    active.delete(id); visited.add(id);
  }
  for (const id of ids) visit(id);
  for (const s of scenarios) {
    check(ids.has(s.finding) && levels.includes(s.level) && statuses.includes(s.status) && nonempty(s.specification), `${s.id}: invalid scenario`);
    check(s.id === `${s.finding}-${s.level}`, `${s.id}: unstable scenario ID`);
    check(s.status !== 'verified' || findings.find((f) => f.id === s.finding)?.verification, `${s.id}: verified without finding proof`);
  }
  check(new Set(catalogue.fields.map((f) => f.field)).size === catalogue.fields.length, 'Duplicate completeness fields');
  for (const f of catalogue.fields) check(nonempty(f.field) && f.finding_ids.length > 0 && f.finding_ids.every((id) => ids.has(id)), `${f.field}: missing completeness traceability`);
  check(new Set(decisions.map((d) => d.id)).size === decisions.length, 'Duplicate decisions');
  for (const d of decisions) {
    check(['open', 'resolved'].includes(d.status) && d.finding_ids.length > 0 && d.finding_ids.every((id) => ids.has(id)), `${d.id}: invalid decision`);
    if (d.status === 'resolved') check([d.choice, d.rationale, d.approved_by].every(nonempty), `${d.id}: resolution lacks choice/rationale/approver`);
    if (requireVerified) check(d.status === 'resolved', `${d.id}: decision open`);
  }
  check(new Set(register.investigation_intake.map((i) => i.id)).size === register.investigation_intake.length, 'Duplicate intake IDs');
  for (const i of register.investigation_intake) {
    check(['open', 'resolved'].includes(i.status) && nonempty(i.required_evidence), `${i.id}: invalid intake`);
    if (i.status === 'resolved') check(nonempty(i.resolution), `${i.id}: missing investigation resolution`);
    if (requireVerified) check(i.status === 'resolved', `${i.id}: investigation open`);
  }
  return errors;
}

export function loadPlan(root = projectRoot) {
  const read = (name) => JSON.parse(readFileSync(resolve(root, 'docs/research-correctness', name), 'utf8'));
  return { register: read('fix-register.json'), scenarios: read('acceptance-scenarios.json').scenarios, catalogue: read('completeness-catalogue.json'), decisions: read('decisions.json').decisions };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const plan = loadPlan();
    const errors = validatePlan(plan, { requireVerified: process.argv.includes('--require-verified') });
    if (errors.length) { process.stderr.write(errors.join('\n') + '\n'); process.exitCode = 1; }
    else process.stdout.write(`Structure valid: ${plan.register.findings.length} findings, ${plan.scenarios.length} scenario specifications, ${plan.catalogue.fields.length} completeness fields. Recorded evidence only; application tests are not executed.\n`);
  } catch (error) { process.stderr.write(`Invalid plan: ${error.message}\n`); process.exitCode = 1; }
}
