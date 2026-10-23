import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {AgentResearchStore} from './agent-research-store';
import type {AgentThread} from './agent-store';
import {buildAllDiscoveredCompanyPolicy} from '@/domain/research-discovery-policy';
import {buildHybridCompanyContinuationSource,type HybridCompanyContinuationReview} from '@/domain/hybrid-company-continuation';
const sourceRootId='00000000-0000-4000-8000-000000000001',thread:AgentThread={id:'00000000-0000-4000-8000-000000000002',organization_id:'owned-org',mandate_id:'00000000-0000-4000-8000-000000000003',owner_user_id:'owned-actor',revision:1};
async function fixture(){
 const records=Array.from({length:200},(_,i)=>({id:'f'+i,name:'Synthetic company '+i,website:'https://c'+i+'.example',sourceMetadata:'x'.repeat(6000)}));
 const original={id:sourceRootId,status:'partial',claimedKeys:[] as string[],children:[] as Array<{id:string;config:Record<string,unknown>}>,config:{pipelineDesign:'hybrid-firmable-v1',researchRunId:sourceRootId,companyIdentityPolicyVersion:1,companyDiscoveryPolicy:buildAllDiscoveredCompanyPolicy(),companyOnly:true,includeCompanyPeople:false,includePhones:false,findPeople:false,firmableSearchPages:{'0':{records:records.slice(0,100)},'100':{records:records.slice(100)}},hybridResult:{discoveryPolicy:buildAllDiscoveredCompanyPolicy(),selection:records.map((r,i)=>({candidateKey:'firmable:'+r.id,domain:'c'+i+'.example',firmableId:r.id,sources:['firmable'],outcome:'not_started'}))}}};
 const source=await buildHybridCompanyContinuationSource({sourceRootId:original.id,status:original.status,config:original.config}),query=vi.fn(async()=>({rows:[]})),client={query} as unknown as PoolClient;
 class Harness extends AgentResearchStore{
  protected override async companyContinuationSources(){return[original];}
  prepare(review:HybridCompanyContinuationReview){return this.companyContinuationSnapshot(client,thread,review);}
 }
 const store=new Harness({} as Pick<Pool,'connect'>,{organizationId:thread.organization_id,userId:thread.owner_user_id}),review:HybridCompanyContinuationReview={version:1,sourceRootId,sourceDigest:source.sourceDigest,candidateKeys:source.candidates.map(c=>c.candidateKey!)};
 return{store,review,original,source,query};
}
it('refuses a valid source selection exceeding the existing worker checkpoint limit before proposal review or dispatch',async()=>{
 const f=await fixture();expect(Buffer.byteLength(JSON.stringify(f.original.config))).toBeLessThan(4*1024*1024);expect(Buffer.byteLength(JSON.stringify(f.source))).toBeGreaterThan(1024*1024);
 await expect(f.store.prepare(f.review)).rejects.toThrow(/checkpoint|smaller selection/);expect(f.query).not.toHaveBeenCalled();
});
it('accepts a bounded subset with the same full original source digest and evidence, without truncating provider rows',async()=>{
 const f=await fixture(),before=JSON.stringify(f.original),selectedKeys=f.review.candidateKeys.slice(0,100),selected=await f.store.prepare({...f.review,candidateKeys:selectedKeys});
 expect(selected.sourceDigest).toBe(f.review.sourceDigest);expect(selected.candidates.map(c=>c.candidateKey)).toEqual(selectedKeys);expect(Buffer.byteLength(JSON.stringify(selected))).toBeLessThan(1024*1024);expect(selected.candidates[0].firmableRow).toEqual(f.original.config.firmableSearchPages['0'].records[0]);expect(selected.candidates[0].firmableRow?.sourceMetadata).toHaveLength(6000);expect(JSON.stringify(f.original)).toBe(before);expect(f.query).not.toHaveBeenCalled();
});
