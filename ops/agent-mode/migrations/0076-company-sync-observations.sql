-- AG26: genuine normal Firmable refresh origins. No fake research job, no
-- historical backfill and no mutation of existing immutable observations.
ALTER TABLE public.company_identity_observations ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE public.company_identity_observations ADD COLUMN source_kind text NOT NULL DEFAULT 'research_job';
ALTER TABLE public.company_identity_observations ADD COLUMN firmable_sync_run_id uuid REFERENCES public.firmable_sync_runs(id);
ALTER TABLE public.company_identity_observations ADD COLUMN source_provenance jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.company_identity_observations ADD CONSTRAINT company_identity_source_origin CHECK (
 jsonb_typeof(source_provenance)='object' AND octet_length(source_provenance::text)<=8000 AND
 ((source_kind='research_job' AND job_id IS NOT NULL AND firmable_sync_run_id IS NULL) OR
 (source_kind='firmable_sync' AND job_id IS NULL AND firmable_sync_run_id IS NOT NULL AND
 source_provenance->>'runId' IS NOT NULL AND source_provenance->>'runId'=firmable_sync_run_id::text AND
 source_provenance->>'responseId' IS NOT NULL AND source_provenance->>'responseId' ~ '^[a-f0-9-]{36}$' AND
 source_provenance->>'responseHash' IS NOT NULL AND source_provenance->>'responseHash' ~ '^[a-f0-9]{64}$' AND
 source_provenance->>'generation' IS NOT NULL AND source_provenance->>'generation' ~ '^[1-9][0-9]*$'))
);
CREATE UNIQUE INDEX company_identity_one_sync_origin ON public.company_identity_observations(firmable_sync_run_id) WHERE source_kind='firmable_sync';
-- Preserve every pre-existing view column/type/order. New provenance is additive
-- at the end; 0075 readers continue to authenticate the same source facts.
CREATE OR REPLACE VIEW public.company_identity_accepted_observations WITH (security_invoker=true) AS
 SELECT o.id,o.request_key,o.organization_id,o.mandate_id,o.job_id,o.created_by,o.source,o.source_facts,o.input_digest,o.observed_at,o.created_at,r.target_id,
 o.source_kind,o.firmable_sync_run_id,o.source_provenance
 FROM public.company_identity_observations o JOIN public.company_identity_resolutions r ON r.observation_id=o.id AND r.organization_id=o.organization_id WHERE r.target_id IS NOT NULL
 UNION ALL
 SELECT o.id,o.request_key,o.organization_id,o.mandate_id,o.job_id,o.created_by,o.source,o.source_facts,o.input_digest,o.observed_at,o.created_at,(d.receipt->>'targetId')::uuid AS target_id,
 o.source_kind,o.firmable_sync_run_id,o.source_provenance
 FROM public.company_identity_observations o JOIN public.company_identity_reviews v ON v.observation_id=o.id AND v.organization_id=o.organization_id AND v.mandate_id=o.mandate_id
 JOIN public.company_identity_decisions d ON d.review_id=v.id AND d.organization_id=v.organization_id AND d.mandate_id=v.mandate_id WHERE d.receipt->>'status'='adopted';
REVOKE ALL ON public.company_identity_accepted_observations FROM PUBLIC;
