import {sql,type SQL} from 'drizzle-orm';
export type ResearchPersistenceDatabase={execute(query:SQL):PromiseLike<unknown>};
/** Source persistence shares the policy writer's global EXCLUSIVE lock. Acquire
 * it before any organization, membership, job or source row lock. Never upgrade
 * an actor transaction's SHARED admission lock while it holds scoped rows. */
export async function lockResearchPersistence(database:ResearchPersistenceDatabase,organizationId:string){
 await database.execute(sql`DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND classid=(7426619361492031::bigint >> 32)::oid AND objid=(7426619361492031::bigint & 4294967295::bigint)::oid AND objsubid=1 AND mode='ShareLock' AND granted)
  AND NOT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND classid=(7426619361492031::bigint >> 32)::oid AND objid=(7426619361492031::bigint & 4294967295::bigint)::oid AND objsubid=1 AND mode='ExclusiveLock' AND granted)
  THEN RAISE EXCEPTION 'Research persistence must begin before scoped admission locks';END IF;
  PERFORM pg_advisory_xact_lock(7426619361492031::bigint);
 END $$`);
 await database.execute(sql`SELECT public.communications_lock_send_gate(${organizationId})`);
}
