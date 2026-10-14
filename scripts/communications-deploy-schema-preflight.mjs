import {pathToFileURL} from 'node:url';
export const applicationTables=['communication_bindings','communication_defaults','campaign_channel_bindings','campaign_attempt_bindings','outreach_draft_bindings','communication_reply_monitors','communication_event_receipts','communication_consumer_checkpoints','communication_reply_review_latches','communication_send_gates','communication_member_fence','communication_dispatch_intents','communication_intent_resolutions','communication_dispatch_permits'].map(n=>'public.'+n);
export const serviceTables=['access_grants','physical_accounts','connections','connection_generations','operation_journal','account_leases','quota_buckets','auth_states','identity_aliases','event_cursors','webhook_inbox','events','event_outbox','tenant_reply_barriers','webhook_receipt_routes','reply_review_latches','connection_retirements','email_tracking_acknowledgements','email_tracking_associations','dispatch_admissions','application_quota_buckets','account_runtime_metadata','connection_defaults','setup_notification_inbox','provider_webhook_spool','history_initial_sync','history_refreshes'].map(n=>'communications.'+n);
async function inspect(client,tables,roles,repair){
 try{
  await client.connect();await client.query('BEGIN READ ONLY');
  const relations=await client.query("SELECT array_agg(required.name) FILTER (WHERE c.oid IS NULL OR c.relkind<>'r' OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity) AS missing FROM unnest($1::text[]) AS required(name) LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass(required.name)",[tables]);
  if(relations.rows.length!==1||relations.rows[0].missing!==null)throw Error();
  const authority=await client.query('SELECT count(*)::integer AS valid FROM pg_catalog.pg_roles WHERE rolname=ANY($1::text[]) AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin',[roles]);
  if(authority.rows.length!==1||authority.rows[0].valid!==roles.length)throw Error();
  if(repair){
   const r=await client.query("SELECT p.prosrc,p.prosecdef,p.proconfig,(SELECT count(*)::integer FROM pg_catalog.pg_trigger t WHERE t.tgfoid=p.oid AND NOT t.tgisinternal) AS triggers FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('communications.guard_provider_spool_account_work()')");
   const p=r.rows[0];if(r.rows.length!==1||p.prosecdef!==false||JSON.stringify(p.proconfig)!==JSON.stringify(['search_path=pg_catalog'])||p.triggers!==3||! /IF\s+TG_TABLE_NAME\s*=\s*'operation_journal'\s+THEN\s+IF\s+NEW\.state\s*<>\s*'dispatching'\s+THEN\s+RETURN\s+NEW;\s+END\s+IF;\s+END\s+IF;/i.test(p.prosrc))throw Error();
  }
 }finally{try{await client.query('ROLLBACK');}catch{}await client.end();}
}
/** Catalog inspection only; neither application data nor schema may be written. */
export async function checkDeploymentSchema({application,service}){
 try{await inspect(application,applicationTables,['acquire_campaign_user','acquire_campaign_worker','acquire_communications_writer'],false);await inspect(service,serviceTables,['communications_scoped','communications_control'],true);}
 catch{throw Error('Communications deployment storage prerequisites unavailable');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const {prepareServiceEnvironment}=await import('./runtime.mjs');const env=prepareServiceEnvironment(process.env);const {Client}=await import('pg');
  const application=new Client({connectionString:env.DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:5000,...(env.DATABASE_SSL_CA?{ssl:{ca:env.DATABASE_SSL_CA,rejectUnauthorized:true}}:{})});
  const service=new Client({connectionString:env.COMMUNICATIONS_DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:5000});
  await checkDeploymentSchema({application,service});console.log('Communications deployment storage prerequisites verified read-only.');
 }catch{process.stderr.write('Communications deployment storage prerequisites unavailable.\n');process.exitCode=1;}
}
