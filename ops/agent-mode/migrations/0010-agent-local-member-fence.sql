-- The isolated pilot clone copies schema and safe business rows, excluding
-- historical authority. Restore the communications protocol's static singleton;
-- writer_xid=0 carries no historical transaction or sending authority.
SELECT pg_advisory_xact_lock(7426619361492031::bigint);
INSERT INTO public.communication_member_fence(singleton,writer_xid)
VALUES(true,0) ON CONFLICT(singleton) DO NOTHING;
