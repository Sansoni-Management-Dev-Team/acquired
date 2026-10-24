#!/usr/bin/env python3
"""WF-03 bounded two-session races; exact isolated rehearsal only, no DDL/providers.
Synthetic committed admission rows are intentionally retained: immutable history
must not be removed or triggers disabled merely to clean up an acceptance test.
"""
import json, pathlib, subprocess, threading, time, uuid
ROOT=pathlib.Path(__file__).resolve().parents[5]
OUT=ROOT/'.local-data/workflow-modularity/approved-rehearsal/concurrency-results.json'
CMD=['docker','exec','-i','acquire-hosted-demo-rehearsal-postgres','psql','-U','postgres','-d','acquire_hosted_demo_rehearsal','-X','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def run(sql):
 r=subprocess.run(CMD,input=sql,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=15)
 return {'exit':r.returncode,'output':r.stdout}
def require(ok,message):
 if not ok: raise AssertionError(message)
network=subprocess.check_output(['docker','inspect','acquire-hosted-demo-rehearsal-postgres','--format','{{.HostConfig.NetworkMode}}'],text=True).strip()
require(network=='none','Expected network-none rehearsal')
identity=run("SELECT current_database(),system_identifier,shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') FROM pg_control_system();")
require(identity['exit']==0 and identity['output'].strip()=='acquire_hosted_demo_rehearsal|7699248227334438947|acquire-hosted-demo-rehearsal-only','Exact target required')
org,actor=[str(uuid.uuid4()) for _ in range(2)]
mandates=[str(uuid.uuid4()) for _ in range(4)]
requests=[str(uuid.uuid4()) for _ in range(5)]
setup=f"""BEGIN; SET LOCAL statement_timeout='5s';
INSERT INTO public.communication_member_fence(singleton,writer_xid) VALUES(true,0) ON CONFLICT DO NOTHING;
INSERT INTO public.\"user\"(id,name,email) VALUES('{actor}','WF-03 isolated race fixture','{actor}@example.invalid');
INSERT INTO public.organization(id,name,slug) VALUES('{org}','WF-03 isolated race fixture','{org}');
INSERT INTO public.member(id,organization_id,user_id,role) VALUES('{uuid.uuid4()}','{org}','{actor}','member');
"""+''.join(f"INSERT INTO public.mandates(id,organization_id,created_by,natural_language,filters,provenance) VALUES('{m}','{org}','{actor}','WF-03 isolated race fixture','{{\"brief\":{{}}}}','{{}}');\n" for m in mandates)+"COMMIT;"
r=run(setup);require(r['exit']==0,r['output'])
def agent():
 return f"BEGIN; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='5s'; SET LOCAL ROLE acquire_agent_user; SET LOCAL app.acquire_org='{org}'; SET LOCAL app.acquire_user='{actor}'; SET LOCAL app.acquire_workflow_version='1';\n"
def start(m,request):
 return f"SELECT id FROM public.acquisition_workflow_start('{request}','live-research-test','agent','{m}');\n"
def legacy(m):
 return f"BEGIN; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='5s'; INSERT INTO public.research_jobs(id,organization_id,mandate_id,created_by,status,config) VALUES('{uuid.uuid4()}','{org}','{m}','{actor}','queued','{{}}');\n"
def pair(name,a,b):
 p=subprocess.Popen(CMD,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 lines=[];ready=threading.Event()
 def reader():
  for line in p.stdout:
   lines.append(line)
   if line.strip()=='WF_LOCK_HELD':ready.set()
 t=threading.Thread(target=reader);t.start()
 p.stdin.write(a+"\\echo WF_LOCK_HELD\nSELECT pg_sleep(0.8); COMMIT;\n");p.stdin.close()
 require(ready.wait(6),'First session never reached held lock: '+''.join(lines))
 begun=time.monotonic();rb=run(b);elapsed=time.monotonic()-begun
 p.wait(timeout=10);t.join(timeout=2)
 return {'name':name,'a':{'exit':p.returncode,'output':''.join(lines)},'b':rb,'bElapsedSeconds':round(elapsed,3)}
results=[]
def record(r):
 results.append(r)
 OUT.parent.mkdir(parents=True,exist_ok=True)
 OUT.write_text(json.dumps({'target':identity['output'].strip(),'organization':org,'actor':actor,'mandates':mandates,'requests':requests,'results':results,'passed':False,'status':'in-progress'},indent=2)+'\n')
r=pair('same request replay',agent()+start(mandates[0],requests[0]),agent()+start(mandates[0],requests[0])+"COMMIT;")
record(r);require(r['a']['exit']==r['b']['exit']==0,r);require(requests[0] in r['a']['output'] and requests[0] in r['b']['output'],r)
r=pair('different requests same source',agent()+start(mandates[1],requests[1]),agent()+start(mandates[1],requests[2])+"COMMIT;")
record(r);require(r['a']['exit']==0 and r['b']['exit']==3 and '40001' in r['b']['output'],r)
r=pair('legacy research wins before admission',legacy(mandates[2]),agent()+start(mandates[2],requests[3])+"COMMIT;")
record(r);require(r['a']['exit']==0 and r['b']['exit']==3 and '40001' in r['b']['output'],r)
r=pair('admission wins before legacy research',agent()+start(mandates[3],requests[4]),legacy(mandates[3])+"COMMIT;")
record(r);require(r['a']['exit']==0 and r['b']['exit']==3 and 'Explicit workflow-capable writer required' in r['b']['output'],r)
counts=run(f"SELECT (SELECT count(*) FROM public.acquisition_workflow_executions WHERE organization_id='{org}'),(SELECT count(*) FROM public.research_jobs WHERE organization_id='{org}');")
require(counts['exit']==0 and counts['output'].strip()=='3|1',counts)
require(all('40P01' not in json.dumps(r) for r in results),'Deadlock detected')
require(all(0.4<r['bElapsedSeconds']<5 for r in results),'Second session did not observably wait within bound')
report={'target':identity['output'].strip(),'network':network,'organization':org,'actor':actor,'mandates':mandates,'requests':requests,'results':results,'counts':counts,'passed':True,'persistentFixtures':'Synthetic immutable rehearsal evidence retained; no schema changes or real/provider work'}
OUT.parent.mkdir(parents=True,exist_ok=True);OUT.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'passed':True,'scenarios':[{'name':r['name'],'waitSeconds':r['bElapsedSeconds']} for r in results],'evidence':str(OUT)},indent=2))
