import{readFileSync}from'node:fs';
import{resolve}from'node:path';
import{describe,expect,it}from'vitest';

const predecessor=readFileSync(resolve('ops/agent-mode/migrations/0051-agent-sequence-channel-handover.sql'),'utf8').split('CREATE FUNCTION public.agent_channel_proposal_permitted(p_route uuid,p_stage text)')[1];
const candidatePath=resolve('ops/agent-mode/migrations/0085-agent-cold-quiet-business-clock.sql');
function candidate(){try{return readFileSync(candidatePath,'utf8');}catch{return'';}}
function body(sql:string,tag:string){return sql.split('AS '+tag)[1]?.split(tag)[0];}

describe('SIM28 cold-person quiet business-time forward migration',()=>{
 it('ports the quiet comparison while preserving the complete original body',()=>{
  const original=body(predecessor,'$$'),next=body(candidate(),'$function$');
  expect(next,'Prepared forward0085 must port the installed outer quiet-period function').toBeDefined();
  expect(next?.match(/public\.local_simulator_business_now\(\)/g)).toHaveLength(1);
  expect(next?.includes('clock_timestamp()')).toBe(false);
  expect(next?.replace('public.local_simulator_business_now()','clock_timestamp()')).toBe(original);
 });
 it('keeps the exact local target, predecessor definition, private owner/ACL and postcondition fences',()=>{
  const sql=candidate();
  for(const text of ['acquire_agent_mode','acquire-agent-mode-local-only','7697400069962248225','project_acquire',
   '6b6cc9729270cd85d115f4c60637fc52d64a9d4636e26b8fca422259ad33d96e',
   'e3055a868b9e50eae6a8505489d78c26a675fb53bbea11b03e4101304d87d867',
   '{project_acquire=X/project_acquire}','prosecdef','proconfig','postcondition'])expect(sql).toContain(text);
  expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
  expect(sql).not.toMatch(/\b(?:GRANT|REVOKE|ALTER|UPDATE|INSERT|DELETE)\s/i);
 });
});
