#!/usr/bin/env python3
"""Read-only exact rehearsal comparison to private pre-application catalog."""
import json,subprocess
from pathlib import Path
# Run from repo root; private baseline intentionally is not committed.
root=Path.cwd();evidence=root/'.local-data/workflow-modularity'
def sql(q):
 return subprocess.check_output(['docker','exec','acquire-hosted-demo-rehearsal-postgres','psql','-U','postgres','-d','acquire_hosted_demo_rehearsal','-X','-At','-v','ON_ERROR_STOP=1','-c',q],text=True).strip()
assert subprocess.check_output(['docker','inspect','acquire-hosted-demo-rehearsal-postgres','--format','{{.HostConfig.NetworkMode}}'],text=True).strip()=='none'
assert sql("SELECT current_database()||'|'||system_identifier::text||'|'||shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') FROM pg_control_system()")=='acquire_hosted_demo_rehearsal|7699248227334438947|acquire-hosted-demo-rehearsal-only'
original=[r for group in json.loads((evidence/'catalog.private.json').read_text())['results'] for r in group if r.get('section')=='functions']
current=json.loads(sql("SELECT json_object_agg(p.oid::regprocedure::text,pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'"))
substitutions={'agent_mandate_execution_modes':'agent_effective_execution_modes','agent_demo_contact_mappings':'agent_effective_demo_contact_mappings','agent_demo_mapping_requests':'agent_effective_demo_mapping_requests','agent_demo_mapping_receipts':'agent_effective_demo_mapping_receipts'}
results=[]
for row in original:
 name=row['identity'];old=row['detail']['definition'];new=current[name]
 if old==new: status='exactly unchanged'
 else:
  expected=old
  for before,after in substitutions.items():expected=expected.replace('public.'+before,'public.'+after)
  assert new==expected,f'Unexpected predecessor behavior change: {name}'
  status='only effective-read source substitution'
 results.append({'function':name,'status':status})
report={'verifiedReadOnly':True,'functions':results,'count':len(results),'unchanged':sum(r['status']=='exactly unchanged' for r in results),'effectiveReadSubstitutions':sum(r['status']!='exactly unchanged' for r in results),'runtimeReceiptRecoveryClaimed':False}
(evidence/'approved-rehearsal/004-legacy-predecessors.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='functions'},indent=2))
