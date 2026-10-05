import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {createAbnIdentityResolver} from '../src/adapters/abn-identity-resolver';
import type {AbnRecord,IdentityPage} from '../src/domain/abn-resolution.mjs';
import type {AuditCompany,AuditMatch} from './abn-recovery-audit-lib.mjs';
// Explicitly opt into locally captured evidence; CI never depends on private audit files.
it.runIf(Boolean(process.env.ABN_AUDIT_REPORT))('replays all corroborated recoveries through the main pipeline adapter',async()=>{
 const report=JSON.parse(readFileSync(process.env.ABN_AUDIT_REPORT!,'utf8')) as {results:{company:AuditCompany;baselineAbn:string|null;assessment:{status:string;match:AuditMatch|null};records:AbnRecord[];pages:IdentityPage[];providerAbns:string[]}[]};
 const recovered=report.results.filter(r=>!r.baselineAbn&&r.assessment.status==='corroborated');
 expect(recovered.length).toBeGreaterThan(0);
 for(const row of recovered){
  const resolve=createAbnIdentityResolver({
   record:async abn=>{const record=row.records.find(r=>r.abn===abn);if(!record)throw Error('Uncaptured registry record');return record;},
   website:async()=>{throw Error('Replay must use captured website evidence');},
   search:async()=>{throw Error('Corroborated recovery must not need additional name searches');}
  });
  const result=await resolve({name:row.company.name,website:`https://${row.company.domain}`,explicitAbns:row.providerAbns.map(abn=>({abn,sourcePath:'captured_provider_abn'})),prior:{websitePages:row.pages,records:row.records}});
  expect(result.abn,row.company.domain).toBe(row.assessment.match?.abn);
  expect(result.status,row.company.domain).toBe('matched');
 }
});
