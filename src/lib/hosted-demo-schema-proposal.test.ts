import{readFileSync}from'node:fs';
import{createHash}from'node:crypto';
import{expect,it}from'vitest';
const file=new URL('../../ops/agent-mode/proposals/hosted-demo-registration.proposed.sql',import.meta.url);
it('keeps the prepared migration fail-closed until an exact database target and reviewed predecessor bodies are selected',()=>{
 const sql=readFileSync(file,'utf8');expect(sql).toContain("current_setting('app.hosted_demo_schema_target',true)");expect(sql).toContain('pg_control_system()');expect(sql).toContain('source_body_sha');expect(sql).toContain('p.provolatile::text IS DISTINCT FROM expected.volatility');expect(sql).toContain('PROPOSAL ONLY');expect(sql).toContain('BEGIN;');expect(sql.trim()).toMatch(/COMMIT;$/);
});
it('preserves the original registration/runtime implementations rather than weakening source, mode or live account checks',()=>{
 const sql=readFileSync(file,'utf8');for(const name of['agent_demo_run_bindings_match','agent_demo_runtime_ready'])expect(sql).toContain(`ALTER FUNCTION public.${name}`);
 const hosted=sql.split('-- Hosted-only registration predicate.')[1]?.split('-- Preserve original')[0];expect(hosted).toBeDefined();expect(hosted).not.toContain('communications.connections');expect(hosted).toContain('agent_recorded_binding_digest');expect(hosted).toContain('service_account_id');expect(hosted).toContain('public.member');expect(sql).toContain('FORCE ROW LEVEL SECURITY');expect(sql).toContain('public.agent_hosted_demo_access_ready(p_run text,p_integration text,p_config text)');expect(sql).toContain("(to_jsonb(NEW)-'enabled') IS DISTINCT FROM (to_jsonb(OLD)-'enabled')");expect(sql).toContain("clock_timestamp()-interval '5 minutes'");expect(sql).toContain('REVOKE ALL ON public.agent_hosted_demo_registrations FROM PUBLIC,acquire_agent_user,acquire_campaign_user');
});
it('changes only the final routed hours veto and preserves the actual cadence and invitation/message authority bodies',()=>{
 const sql=readFileSync(file,'utf8');expect(sql).toContain('agent_hosted_demo_send_window_exempt(r.id)');expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public.agent_channel_(?:local_binding|proposal_permitted)/);expect(sql).not.toMatch(/UPDATE public.agent_channel_policies|session_replication_role|DISABLE TRIGGER/);
 for(const [path,name]of[['127-app5437-gui-send-window.proposed.sql','agent_channel_operation_before_invitations'],['127-app5437-gui-send-window.proposed.sql','agent_invitation_before_company_projection']]){const source=readFileSync(new URL('../../ops/agent-mode/migrations/'+path,import.meta.url),'utf8'),start=source.indexOf('CREATE OR REPLACE FUNCTION public.'+name),body=source.slice(start).match(/AS \$function\$([\s\S]*?)\$function\$/)?.[1];expect(body).toBeDefined();expect(sql).toContain(createHash('sha256').update(body!).digest('hex'));}
});
