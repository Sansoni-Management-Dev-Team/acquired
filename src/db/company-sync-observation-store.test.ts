import {expect,it,vi,beforeEach} from 'vitest';
const publish=vi.hoisted(()=>vi.fn().mockResolvedValue({published:true}));
vi.mock('./company-membership-projection-store',()=>({publishCompanyMembershipProjection:publish}));
import {appendFirmableSyncCompanyObservation,type FirmableSyncCompanyObservationInput} from './company-sync-observation-store';
import {responseHash} from '../domain/firmable-history';
const id='11111111-1111-4111-8111-111111111111',receiptId='22222222-2222-4222-8222-222222222222';
const input=():FirmableSyncCompanyObservationInput=>({runId:id,mandateId:id,targetId:id,expectedGeneration:1,source:{companyName:'Example',domain:'example.test',firmableId:'f1'},sourceFacts:{firmographics:{description:'Fresh'},identifiers:{},firmableCompanyId:'f1'}});
beforeEach(()=>publish.mockClear());
function fixture(options:{legacy?:boolean;protectedOther?:boolean;status?:string;generation?:number;responseId?:string;badHash?:boolean;replay?:boolean}={}){
 const raw={id:options.responseId??'f1',fqdn:'example.test'},statements:{text:string;args:unknown[]}[]=[];
 const query=vi.fn(async(text:string,args:unknown[]=[])=>{statements.push({text,args});let rows:Record<string,unknown>[]=[];
 if(text.includes('FROM member'))rows=[{id}];
 else if(text.includes('FROM firmable_sync_runs'))rows=[{id,organization_id:'org',actor_id:'user',target_id:id,generation:options.generation??1,status:options.status??'running',firmable_company_id:'f1'}];
 else if(text.includes('FROM mandate_targets'))rows=[{target_id:id}];
 else if(text.includes('FROM company_identity_accepted_observations'))rows=options.legacy?(options.protectedOther&&!text.includes('mandate_id')?[{id}]:[]):[{id,source:{companyName:'Example',domain:'example.test',firmableId:'f1'}}];
 else if(text.includes('FROM company_identity_observations o'))rows=options.replay?[{id,source_kind:'firmable_sync',firmable_sync_run_id:id,organization_id:'org',created_by:'user',mandate_id:id,target_id:id}]:[];
 else if(text.includes('FROM targets WHERE'))rows=[{id,domain:'example.test',firmable_company_id:'f1'}];
 else if(text.includes('FROM firmable_companies'))rows=[{people_generation:1}];
 else if(text.includes('FROM firmable_company_responses'))rows=[{id:receiptId,firmable_company_id:'f1',response:raw,response_hash:options.badHash?'b'.repeat(64):responseHash(raw),fetched_at:'2026-10-18T00:00:00Z'}];
 return{rows,rowCount:rows.length};});return{query,statements};
}
it('keeps a legacy no-observation membership on its existing path',async()=>{
 const f=fixture({legacy:true});expect(await appendFirmableSyncCompanyObservation(f as never,{organizationId:'org',userId:'user'},input())).toEqual({handled:false,legacy:true});expect(f.statements.some(s=>s.text.includes('INSERT INTO'))).toBe(false);
});
it('appends genuine sync provenance without a fake research job or canonical target update, then publishes',async()=>{
 const f=fixture();expect(await appendFirmableSyncCompanyObservation(f as never,{organizationId:'org',userId:'user'},input())).toMatchObject({handled:true,targetId:id,replayed:false});
 const inserted=f.statements.find(s=>s.text.startsWith('INSERT INTO company_identity_observations'))!;expect(inserted.text).toContain('NULL');expect(inserted.text).toContain("'firmable_sync'");expect(inserted.args[9]).toEqual({runId:id,responseId:receiptId,responseHash:responseHash({id:'f1',fqdn:'example.test'}),generation:1});
 expect(f.statements.some(s=>/UPDATE (targets|contacts)/.test(s.text))).toBe(false);expect(publish).toHaveBeenCalledOnce();
});
it.each([{status:'cancelled'},{generation:2},{responseId:'f2'},{badHash:true},{legacy:true,protectedOther:true}])('fails closed for changed or unverified source %j',async options=>{
 const f=fixture(options);await expect(appendFirmableSyncCompanyObservation(f as never,{organizationId:'org',userId:'user'},input())).rejects.toThrow();expect(f.statements.some(s=>s.text.includes('INSERT INTO'))).toBe(false);expect(publish).not.toHaveBeenCalled();
});
it('reads original sync receipt without new publication or normalizing new timestamps',async()=>{
 const f=fixture({replay:true,status:'complete'});expect(await appendFirmableSyncCompanyObservation(f as never,{organizationId:'org',userId:'user'},input())).toEqual({handled:true,targetId:id,observationId:id,replayed:true});expect(publish).not.toHaveBeenCalled();expect(f.statements.some(s=>s.text.includes('INSERT INTO'))).toBe(false);
});
it('does not impose a new provider-ID format on the untouched legacy fallback',async()=>{
 const f=fixture({legacy:true}),raw=input();raw.source.firmableId='legacy-provider-id';raw.sourceFacts.firmableCompanyId='legacy-provider-id';expect(await appendFirmableSyncCompanyObservation(f as never,{organizationId:'org',userId:'user'},raw)).toEqual({handled:false,legacy:true});
});
