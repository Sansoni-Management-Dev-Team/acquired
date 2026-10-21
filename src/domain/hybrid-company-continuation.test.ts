import {describe,expect,it,vi} from 'vitest';
import {buildAllDiscoveredCompanyPolicy} from './research-discovery-policy';
import {buildHybridCompanyContinuationSource,selectHybridCompanyContinuation} from './hybrid-company-continuation';
const sourceRootId='00000000-0000-4000-8000-000000000001';
const firm=(id:string,website='')=>({id,name:id,...(website?{website}:{})});
const web=(domain:string,name=domain)=>({domain,name,website:`https://${domain}`,discovery:{url:`https://${domain}`,title:name,snippet:'Synthetic company source'}});
function source(){return{sourceRootId,status:'partial',config:{pipelineDesign:'hybrid-firmable-v1',researchRunId:sourceRootId,companyIdentityPolicyVersion:1,companyDiscoveryPolicy:buildAllDiscoveredCompanyPolicy(),companyOnly:true,includeCompanyPeople:false,includePhones:false,findPeople:false,firmableSearchPages:{'0':{records:[firm('f1','https://saved.example'),firm('f2'),firm('f3','https://interrupted.example')],totalCompany:3}},webSearchPages:{'0':{query:{query:'original synthetic query',page:1},ok:true,rows:[web('web.example')]}},hybridResult:{discoveryPolicy:buildAllDiscoveredCompanyPolicy(),selection:[{candidateKey:'firmable:f1',domain:'saved.example',firmableId:'f1',sources:['firmable'],outcome:'saved'},{candidateKey:'firmable:f2',domain:'',firmableId:'f2',sources:['firmable'],outcome:'not_started'},{candidateKey:'firmable:f3',domain:'interrupted.example',firmableId:'f3',sources:['firmable'],outcome:'interrupted'},{candidateKey:'domain:web.example',domain:'web.example',firmableId:null,sources:['web'],outcome:'not_started'}]}}};}
describe('saved V4 candidate continuation',()=>{
 it('selects only explicit never-started identities and retains original source rows without provider I/O',async()=>{
  const network=vi.spyOn(globalThis,'fetch');const raw=source(),snapshot=await buildHybridCompanyContinuationSource(raw);
  expect(snapshot.candidates.map(c=>c.candidateKey)).toEqual(['firmable:f2','domain:web.example']);expect(snapshot.candidates[0]).toMatchObject({domain:'',firmableRow:raw.config.firmableSearchPages['0'].records[1]});expect(snapshot.candidates[1]).toMatchObject({webRow:raw.config.webSearchPages['0'].rows[0]});expect(snapshot.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
  const selected=selectHybridCompanyContinuation(snapshot,{version:1,sourceRootId,sourceDigest:snapshot.sourceDigest,candidateKeys:['domain:web.example']});expect(selected.candidates.map(c=>c.candidateKey)).toEqual(['domain:web.example']);expect(network).not.toHaveBeenCalled();network.mockRestore();
 });
 it('canonicalizes object key order but invalidates digest after source rows or outcomes change',async()=>{
  const raw=source(),first=await buildHybridCompanyContinuationSource(raw),reordered=JSON.parse(JSON.stringify(raw,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v));
  expect((await buildHybridCompanyContinuationSource(reordered)).sourceDigest).toBe(first.sourceDigest);
  raw.config.firmableSearchPages['0'].records[1].name='Changed source';expect((await buildHybridCompanyContinuationSource(raw)).sourceDigest).not.toBe(first.sourceDigest);
  raw.config.hybridResult.selection[0].outcome='review';expect((await buildHybridCompanyContinuationSource(raw)).sourceDigest).not.toBe(first.sourceDigest);
 });
 it.each(['saved','interrupted','known_failed','review','skipped'])('never treats an original %s candidate as new work',async outcome=>{
  const raw=source();raw.config.hybridResult.selection[1].outcome=outcome;const snapshot=await buildHybridCompanyContinuationSource(raw);
  expect(snapshot.candidates.map(c=>c.candidateKey)).toEqual(['domain:web.example']);expect(()=>selectHybridCompanyContinuation(snapshot,{version:1,sourceRootId,sourceDigest:snapshot.sourceDigest,candidateKeys:['firmable:f2']})).toThrow();
 });
 it.each(['missing_outcome','wrong_domain','missing_source','duplicate_key','active_source','wrong_policy','people_scope'])('rejects unsafe saved evidence: %s',async change=>{
  const raw=source();if(change==='missing_outcome')delete (raw.config.hybridResult.selection[1] as {outcome?:string}).outcome;
  if(change==='wrong_domain')raw.config.hybridResult.selection[1].domain='invented.example';if(change==='missing_source')raw.config.firmableSearchPages['0'].records.splice(1,1);
  if(change==='duplicate_key')raw.config.hybridResult.selection.push({...raw.config.hybridResult.selection[1]});if(change==='active_source')raw.status='extracting';
  if(change==='wrong_policy')(raw.config.companyDiscoveryPolicy as {version:number}).version=3;if(change==='people_scope')raw.config.includeCompanyPeople=true;
  await expect(buildHybridCompanyContinuationSource(raw)).rejects.toThrow();
 });
 it('rejects stale digests, another source, duplicate/unknown selections, and zero selections',async()=>{
  const snapshot=await buildHybridCompanyContinuationSource(source()),review={version:1 as const,sourceRootId,sourceDigest:snapshot.sourceDigest,candidateKeys:['firmable:f2']};
  for(const changed of[{sourceDigest:'a'.repeat(64)},{sourceRootId:'00000000-0000-4000-8000-000000000002'},{candidateKeys:['firmable:f2','firmable:f2']},{candidateKeys:['firmable:f404']},{candidateKeys:[]}])expect(()=>selectHybridCompanyContinuation(snapshot,{...review,...changed})).toThrow();
 });
 it('fails closed on oversized source evidence rather than truncating the digest or candidate set',async()=>{
  const raw=source();Object.assign(raw.config.firmableSearchPages['0'].records[1],{large:'x'.repeat(4*1024*1024)});await expect(buildHybridCompanyContinuationSource(raw)).rejects.toThrow();
 });
 it('rejects continuation of a continuation without rediscovering or borrowing ancestor sources',async()=>{
  const raw=source();Object.assign(raw.config,{companyContinuation:{version:1,sourceRootId:'00000000-0000-4000-8000-000000000009',sourceDigest:'a'.repeat(64),candidateKeys:['firmable:f2']}});await expect(buildHybridCompanyContinuationSource(raw)).rejects.toThrow('Continuation of a continuation');
 });
 it('reconstructs the original round-robin first web observation instead of choosing by page flattening',async()=>{
  const raw=source();raw.config.webSearchPages={'0':{query:{query:'first',page:1},ok:true,rows:[web('other.example'),web('web.example','later row')]},'1':{query:{query:'second',page:1},ok:true,rows:[web('web.example','original first observation')]}} as typeof raw.config.webSearchPages;
  const snapshot=await buildHybridCompanyContinuationSource(raw);expect(snapshot.candidates.find(c=>c.candidateKey==='domain:web.example')?.webRow?.name).toBe('original first observation');
 });
});
