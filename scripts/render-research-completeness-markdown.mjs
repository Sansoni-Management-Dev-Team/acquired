import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const display = value => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const escape = value => display(value).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const table = (headers, rows) => [headers, headers.map(() => '---'), ...rows].map(row => `| ${row.map(escape).join(' | ')} |`).join('\n');

/** Offline rendering; contact values in the input projection are counts only. */
export function renderCompletenessMarkdown(report, history = []) {
 const companies = report.companies;
 if (!Array.isArray(companies)) throw Error('Company projection required');
 const fields = [...new Set(companies.flatMap(company => company.cells.map(cell => cell.field)))];
 const cell = (company, field) => company.cells.find(c => c.field === field);
 const statuses = ['verified', 'reported', 'estimated', 'reviewed', 'unavailable', 'unattempted', 'failed', 'not_applicable'];
 const summaryFields = ['ABN', 'Description', 'AU headcount', 'AU revenue band', 'Saved EBITDA', 'Contact coverage by company'];
 const show = value => value ? `${value.status}: ${display(value.value)}` : 'unattempted';
 const activeCount = counts => Object.entries(counts || {}).filter(([status]) => !['complete', 'partial', 'failed', 'cancelled'].includes(status)).reduce((n, [, count]) => n + count, 0);
 const latest = history.at(-1);
 const sections = [
  '# Laboratory mandate — company data completeness',
  `Last observed: ${report.historicalSnapshot}. ${companies.length} companies; ${fields.length} datapoints per company; ${companies.reduce((n,c) => n+c.cells.length,0)} classified cells.`,
  latest ? `Research state: ${latest.finished ? 'no active company or contact jobs in this snapshot' : 'in progress'}. Company jobs: ${JSON.stringify(latest.jobs)}. Contact runs: ${JSON.stringify(latest.sync || {})}.` : '',
  report.note || '',
  'Reported values are source claims, estimated values are models, and verified values have verification evidence. Unavailable means no retained value; failed means the source read was incomplete. Unattempted diligence remains outstanding. Global revenue does not establish Australian revenue. A saved contact count of zero does not prove that a contact search was attempted. Operational cells marked unattempted mean that reconciliation was not supplied to that individual cell; the run summary below supplies aggregate monitoring evidence.',
  report.runNotes?.length ? `## Run observations\n\n${report.runNotes.map(note => `- ${note}`).join('\n')}` : '',
  '## Company summary',
  table(['Company', ...summaryFields], companies.map(company => [company.companyName, ...summaryFields.map(field => show(cell(company,field)))])),
  '## Datapoint coverage',
  table(['Datapoint', ...statuses], fields.map(field => [field, ...statuses.map(status => companies.filter(company => cell(company,field)?.status === status).length)])),
  history.length ? '## Progress snapshots' : '',
  history.length ? table(['Observed UTC', 'Companies', 'Saved contacts', 'Complete jobs', 'Partial jobs', 'Failed jobs', 'Active company jobs', 'Active contact runs'], history.map(snapshot => [snapshot.observed, snapshot.companies, snapshot.contacts, snapshot.jobs?.complete || 0, snapshot.jobs?.partial || 0, snapshot.jobs?.failed || 0, activeCount(snapshot.jobs), activeCount(snapshot.sync)])) : '',
  '## Per-company datapoints',
  ...companies.flatMap(company => [
   `### ${escape(company.companyName)}`,
   `Company ID: \`${company.companyId}\`. Assessment stage: ${escape(company.assessmentStage)}.`,
   table(['Datapoint', 'Status', 'Value', 'Source', 'Observed UTC', 'Scope / currency / period', 'Reason'], company.cells.map(c => [c.field, c.status, c.value, c.source, c.observed_at, [c.scope,c.currency,c.period].filter(Boolean).join(' / ') || null, c.reason])),
   ...(report.supplementary?.[company.companyId]?.length ? ['Retained observations outside the 53-field projection:', table(['Observation','Value','Scope','Currency','Source','Observed UTC'], report.supplementary[company.companyId].map(f => [f.field,f.value,f.scope,f.currency || 'unknown',f.source,f.capturedAt]))] : []),
  ]),
 ];
 return sections.filter(Boolean).join('\n\n')+'\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const [input, output, timeline] = process.argv.slice(2);
 if (!input || !output) throw Error('Supply projection JSON, output Markdown, and optional snapshot JSONL');
 const report = JSON.parse(readFileSync(input,'utf8'));
 const history = timeline ? readFileSync(timeline,'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
 const temporary = output+'.tmp';
 writeFileSync(temporary,renderCompletenessMarkdown(report,history),{mode:0o600});
 renameSync(temporary,output);
 process.stdout.write(`Updated ${output}: ${report.companies.length} companies.\n`);
}
