import { createHash } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';

// These are application payload sizes, excluding protocol framing, TLS and compression.
// Measure returned records in memory; never issue extra queries or log record contents.
export function researchResultMetrics(result: unknown) {
  const rows: unknown[] = Array.isArray(result) ? result : result && typeof result === 'object' && 'rows' in result && Array.isArray(result.rows) ? result.rows : [];
  try {
    const resultJsonBytes = Buffer.byteLength(JSON.stringify(rows), 'utf8');
    const fieldJsonBytes: Record<string, number> = {};
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      for (const key of ['config', 'evidence', 'sourceData', 'source_data', 'firmographics', 'personal', 'metadata', 'raw', 'profile']) {
        const value = (row as Record<string, unknown>)[key];
        if (value === undefined) continue;
        fieldJsonBytes[key] = (fieldJsonBytes[key] || 0) + Buffer.byteLength(JSON.stringify(value), 'utf8');
      }
    }
    return { rowsReturned: rows.length, resultJsonBytes, fieldJsonBytes, byteMeasurement: 'utf8_json_returned_rows' as const };
  } catch {
    // Instrumentation must never change whether a database operation succeeds.
    return { rowsReturned: rows.length, byteMeasurement: 'unavailable' as const };
  }
}
const tables = new Set(['research_jobs', 'research_findings', 'targets', 'mandate_targets', 'mandates', 'contacts', 'signals', 'organization', 'firmable_companies', 'firmable_people', 'firmable_company_people', 'firmable_company_responses', 'firmable_person_responses', 'firmable_sync_runs', 'firmable_sync_profiles']);
export function researchQueryIdentity(query: unknown): { queryFingerprint?: string; tables?: string[] } {
  try {
    const candidate = query as { toSQL?: () => { sql: string }; getSQL?: () => Parameters<PgDialect['sqlToQuery']>[0] };
    const sql = candidate?.toSQL ? candidate.toSQL().sql : candidate?.getSQL ? new PgDialect().sqlToQuery(candidate.getSQL()).sql : undefined;
    if (!sql) return {};
    // Hash query shape only. Literals, parameters and SQL never enter telemetry.
    const shape = sql.replace(/\/\*[\s\S]*?\*\/|--[^\n]*/g, ' ').replace(/'(?:''|[^'])*'/g, '?').replace(/\$\d+|\b\d+(?:\.\d+)?\b/g, '?').replace(/\s+/g, ' ').trim();
    const referenced = new Set<string>();
    for (const match of shape.matchAll(/\b(?:from|join|update|into)\s+(?:"?public"?\.)?"?([a-z_]+)"?/gi)) if (tables.has(match[1])) referenced.add(match[1]);
    return { queryFingerprint: createHash('sha256').update(shape).digest('hex').slice(0, 16), tables: [...referenced].sort() };
  } catch { return {}; }
}

const callbackStages: Record<string, string> = {
  'provider-reserve': 'provider_admission', 'provider-release': 'provider_admission',
  'browser-permit': 'provider_admission', 'browser-cooldown': 'provider_wait',
  'discovery-context': 'discovery_context', 'targeted-followup': 'targeted_planning',
  'people-followup': 'targeted_planning', 'discovery-sources': 'source_discovery',
  'discovery-persist': 'source_persistence', discover: 'discovery_callback',
  progress: 'persistence', timings: 'telemetry',
};
export function researchCallbackContext(action: unknown) {
  return typeof action === 'string' && Object.hasOwn(callbackStages, action) ? { action, stage: callbackStages[action] } : { action: 'callback', stage: 'control' };
}
