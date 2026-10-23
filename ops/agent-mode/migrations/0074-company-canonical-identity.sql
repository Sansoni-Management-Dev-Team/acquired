-- AG26: additive canonical company claims and explicit duplicate adoption.
-- No historical backfill, target merge, contact copy or buyer decision rewrite.
CREATE TABLE public.company_identity_observations (
 id uuid PRIMARY KEY, request_key uuid NOT NULL UNIQUE,
 organization_id text NOT NULL REFERENCES public.organization(id),
 mandate_id uuid NOT NULL REFERENCES public.mandates(id),
 job_id uuid NOT NULL REFERENCES public.research_jobs(id),
 created_by text NOT NULL REFERENCES public."user"(id),
 source jsonb NOT NULL CHECK(jsonb_typeof(source)='object'),
 source_facts jsonb NOT NULL CHECK(jsonb_typeof(source_facts)='object'),
 input_digest text NOT NULL CHECK(input_digest ~ '^[a-f0-9]{64}$'),
 observed_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX company_identity_observations_mandate ON public.company_identity_observations(organization_id,mandate_id,created_at,id);
CREATE TABLE public.company_identity_reviews (
 id uuid PRIMARY KEY, observation_id uuid NOT NULL UNIQUE REFERENCES public.company_identity_observations(id),
 organization_id text NOT NULL REFERENCES public.organization(id),
 mandate_id uuid NOT NULL REFERENCES public.mandates(id),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','adopted','skipped')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX company_identity_reviews_pending ON public.company_identity_reviews(organization_id,mandate_id) WHERE state='pending';
CREATE TABLE public.company_identity_resolutions (
 observation_id uuid PRIMARY KEY REFERENCES public.company_identity_observations(id),
 organization_id text NOT NULL REFERENCES public.organization(id),
 target_id uuid REFERENCES public.targets(id), review_id uuid REFERENCES public.company_identity_reviews(id),
 CHECK((target_id IS NOT NULL AND review_id IS NULL) OR (target_id IS NULL AND review_id IS NOT NULL))
);
CREATE TABLE public.company_identity_claims (
 organization_id text NOT NULL REFERENCES public.organization(id), identity_key text NOT NULL,
 target_id uuid NOT NULL REFERENCES public.targets(id),
 observation_id uuid NOT NULL REFERENCES public.company_identity_observations(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,identity_key), CHECK(length(identity_key) BETWEEN 3 AND 1200)
);
CREATE TABLE public.company_identity_decisions (
 request_key uuid PRIMARY KEY, review_id uuid NOT NULL UNIQUE REFERENCES public.company_identity_reviews(id),
 organization_id text NOT NULL REFERENCES public.organization(id), mandate_id uuid NOT NULL REFERENCES public.mandates(id),
 decided_by text NOT NULL REFERENCES public."user"(id),
 input_digest text NOT NULL CHECK(input_digest ~ '^[a-f0-9]{64}$'),
 preview jsonb NOT NULL CHECK(jsonb_typeof(preview)='object'),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- These are private application persistence ports. No model/scoped role gets
-- direct table access or arbitrary identity registration/adoption authority.
REVOKE ALL ON public.company_identity_observations,public.company_identity_reviews,public.company_identity_resolutions,public.company_identity_claims,public.company_identity_decisions FROM PUBLIC;
CREATE FUNCTION public.company_identity_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'Company identity evidence is immutable'; END $$;
REVOKE ALL ON FUNCTION public.company_identity_append_only() FROM PUBLIC;
CREATE TRIGGER company_identity_observations_immutable BEFORE UPDATE OR DELETE ON public.company_identity_observations FOR EACH ROW EXECUTE FUNCTION public.company_identity_append_only();
CREATE TRIGGER company_identity_resolutions_immutable BEFORE UPDATE OR DELETE ON public.company_identity_resolutions FOR EACH ROW EXECUTE FUNCTION public.company_identity_append_only();
CREATE TRIGGER company_identity_claims_immutable BEFORE UPDATE OR DELETE ON public.company_identity_claims FOR EACH ROW EXECUTE FUNCTION public.company_identity_append_only();
CREATE TRIGGER company_identity_decisions_immutable BEFORE UPDATE OR DELETE ON public.company_identity_decisions FOR EACH ROW EXECUTE FUNCTION public.company_identity_append_only();
-- A read model may overlay accepted company-only source facts before computing
-- THIS mandate's assessment. This is not a new qualification/outreach grant.
CREATE VIEW public.company_identity_accepted_observations WITH (security_invoker=true) AS
 SELECT o.*,r.target_id FROM public.company_identity_observations o
 JOIN public.company_identity_resolutions r ON r.observation_id=o.id AND r.organization_id=o.organization_id
 WHERE r.target_id IS NOT NULL
 UNION ALL
 SELECT o.*,(d.receipt->>'targetId')::uuid AS target_id FROM public.company_identity_observations o
 JOIN public.company_identity_reviews v ON v.observation_id=o.id AND v.organization_id=o.organization_id AND v.mandate_id=o.mandate_id
 JOIN public.company_identity_decisions d ON d.review_id=v.id AND d.organization_id=v.organization_id AND d.mandate_id=v.mandate_id
 WHERE d.receipt->>'status'='adopted';
REVOKE ALL ON public.company_identity_accepted_observations FROM PUBLIC;
