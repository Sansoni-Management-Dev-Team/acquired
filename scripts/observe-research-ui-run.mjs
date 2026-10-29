// Read-only evidence collector. Never starts, retries, approves or cancels work.
import fs from 'node:fs/promises';
import path from 'node:path';
const [origin,cookieFile,mandateId,evidenceDir]=process.argv.slice(2);
if(!origin||!cookieFile||!evidenceDir||! /^[0-9a-f-]{36}$/i.test(mandateId??''))throw Error('Usage: node --use-system-ca scripts/observe-research-ui-run.mjs ORIGIN PRIVATE_COOKIE_FILE MANDATE_UUID PRIVATE_EVIDENCE_DIR');
const base=new URL(origin);if(base.protocol!=='https:'||base.username||base.password)throw Error('HTTPS origin required');
const cookie=(await fs.readFile(cookieFile,'utf8')).trim();
await fs.mkdir(evidenceDir,{recursive:true,mode:0o700});
const evidence={observedAt:new Date().toISOString(),mandateId};
for(const [name,suffix]of [['mandate',''],['research','/research'],['execution','/agent/execution']]){
 const response=await fetch(new URL(`/api/mandates/${mandateId}${suffix}`,base),{headers:{cookie},signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`${name}: HTTP ${response.status}`);
 evidence[name]=await response.json();
}
await fs.writeFile(path.join(evidenceDir,`${mandateId}.private.json`),JSON.stringify(evidence,null,2),{mode:0o600});
console.log(JSON.stringify({observedAt:evidence.observedAt,mandateId,workflow:evidence.research.workflow,active:evidence.research.active,companies:evidence.mandate.memberships?.length,people:evidence.mandate.contacts?.length,findings:evidence.research.findings?.length,jobStates:evidence.research.jobs?.map(j=>({id:j.id,status:j.status})),conversations:evidence.execution?.state?.conversations?.length??evidence.execution?.conversations?.length??null},null,2));
