import {sql, type SQL} from 'drizzle-orm';
import {z} from 'zod';
import {researchTimingSegments} from '@/domain/research-timing';
const uuid = z.regexes.uuid().source;
const datetime = z.regexes.datetime({}).source;
const fraction = '\\.([0-9]+)Z$';
const astral = `[^${String.fromCodePoint(0x10000)}-${String.fromCodePoint(0x10ffff)}]`;
// Match Date.parse's UTC millisecond truncation, including year 0000 and
// fractions longer than PostgreSQL timestamp's microsecond precision.
function milliseconds(value:SQL) {
 return sql`CASE WHEN jsonb_typeof(${value}) = 'string' AND (${value} #>> '{}') ~ ${datetime} THEN
  extract(epoch FROM make_date(CASE WHEN substring(${value} #>> '{}' FROM 1 FOR 4)::int = 0 THEN 400 ELSE substring(${value} #>> '{}' FROM 1 FOR 4)::int END, substring(${value} #>> '{}' FROM 6 FOR 2)::int, substring(${value} #>> '{}' FROM 9 FOR 2)::int)::timestamp AT TIME ZONE 'UTC') * 1000
  - CASE WHEN substring(${value} #>> '{}' FROM 1 FOR 4)::int = 0 THEN 12622780800000 ELSE 0 END
  + substring(${value} #>> '{}' FROM 12 FOR 2)::int * 3600000 + substring(${value} #>> '{}' FROM 15 FOR 2)::int * 60000
  + CASE WHEN substring(${value} #>> '{}' FROM 17 FOR 1) = ':' THEN substring(${value} #>> '{}' FROM 18 FOR 2)::int * 1000 ELSE 0 END
  + substring(rpad(COALESCE(substring(${value} #>> '{}' FROM ${fraction}), ''), 3, '0') FROM 1 FOR 3)::int
 END`;
}
/** Input relation must expose id, created_at, config and job_order. Filtering
 * organization/run membership happens before this read-only aggregation. */
export function compactResearchTimingQuery(jobs:SQL) {
 const started=milliseconds(sql`value->'startedAt'`),finished=milliseconds(sql`value->'finishedAt'`);
 return sql`WITH timing_jobs AS (${jobs}),
 maps AS (SELECT *, CASE WHEN jsonb_typeof(config->'pipelineTiming') = 'object' THEN config->'pipelineTiming' ELSE '{}'::jsonb END AS timing_map FROM timing_jobs),
 raw AS MATERIALIZED (SELECT m.id,m.job_order,COALESCE(NULLIF(m.config->>'researchRunId',''),NULLIF(m.config->>'parentJobId',''),m.id::text) AS run_id, entry.key, entry.value, entry.position, CASE WHEN entry.key ~ '^(0|[1-9][0-9]{0,9})$' THEN entry.key::numeric END AS index_key FROM maps m CROSS JOIN LATERAL jsonb_each(m.timing_map) WITH ORDINALITY AS entry(key,value,position)),
 ordered AS (SELECT *, row_number() OVER (PARTITION BY id ORDER BY CASE WHEN index_key < 4294967295 THEN 0 ELSE 1 END, CASE WHEN index_key < 4294967295 THEN index_key END, position) AS span_order FROM raw),
 typed AS MATERIALIZED (SELECT *, ${started} AS started_ms, ${finished} AS finished_ms,
 CASE WHEN jsonb_typeof(value->'elapsedMs') = 'number' AND abs((value->>'elapsedMs')::numeric) <= 1000000000 THEN CASE WHEN abs((value->>'elapsedMs')::numeric) < 2.4703282292062327e-324 THEN 0::double precision ELSE (value->>'elapsedMs')::double precision END END AS elapsed
 FROM ordered WHERE jsonb_typeof(value) = 'object'
 AND jsonb_typeof(value->'id') = 'string' AND value->>'id' ~ ${uuid}
 AND jsonb_typeof(value->'step') = 'string' AND length(value->>'step') + length(regexp_replace(value->>'step', ${astral}, '', 'g')) BETWEEN 1 AND 160
 AND jsonb_typeof(value->'segment') = 'string' AND value->>'segment' IN (${sql.join(researchTimingSegments.map(segment=>sql`${segment}`),sql`, `)})
 AND jsonb_typeof(value->'outcome') = 'string' AND value->>'outcome' IN ('succeeded','failed')),
 valid AS (SELECT * FROM typed WHERE elapsed BETWEEN 0 AND 86400000 AND started_ms IS NOT NULL AND finished_ms >= started_ms),
 ranked AS (SELECT *, row_number() OVER (PARTITION BY run_id, value->>'id' ORDER BY job_order DESC, span_order DESC) AS winner, min(job_order * 1000000000::bigint + span_order) OVER (PARTITION BY run_id,value->>'id') AS first_order FROM valid),
 deduped AS (SELECT * FROM ranked WHERE winner = 1),
 segments AS (SELECT run_id,value->>'segment' AS segment, jsonb_agg(elapsed ORDER BY first_order) AS durations, count(*) FILTER (WHERE value->>'outcome'='failed')::int AS failed FROM deduped GROUP BY run_id,value->>'segment'),
 windows AS (SELECT run_id,count(*)::int AS spans,min(started_ms) AS started_ms,max(finished_ms) AS finished_ms FROM deduped GROUP BY run_id),
 runs AS (SELECT COALESCE(NULLIF(config->>'researchRunId',''),NULLIF(config->>'parentJobId',''),id::text) AS run_id, count(*) FILTER (WHERE (SELECT count(*) FROM jsonb_object_keys(timing_map)) >= 2048)::int AS capped_jobs FROM maps GROUP BY 1)
 SELECT runs.run_id AS "runId",COALESCE(windows.spans,0) AS spans,COALESCE(windows.finished_ms-windows.started_ms,0)::double precision AS "measuredWindowMs", runs.capped_jobs AS "cappedJobs",COALESCE((SELECT jsonb_object_agg(segment,jsonb_build_object('durations',durations,'failed',failed)) FROM segments WHERE segments.run_id=runs.run_id),'{}'::jsonb) AS segments FROM runs LEFT JOIN windows ON windows.run_id=runs.run_id`;
}
