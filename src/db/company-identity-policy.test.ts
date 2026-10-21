import { describe,expect,it } from 'vitest';
import { classifyCompanyIdentity, normalizeCompanyIdentity } from './company-identity-policy';
describe('authoritative company identity resolution',()=>{
 const source={companyName:'Example',domain:'https://www.example.test/path',firmableId:'f1',abn:'12345678901'};
 it('normalizes exact identities without treating names as identity',()=>{
 expect(normalizeCompanyIdentity(source)).toEqual({...source,domain:'example.test'});
 expect(()=>normalizeCompanyIdentity({...source,domain:'https://u:p@example.test'})).toThrow();
 });
 it('rejects unsupported provider identity hints rather than promoting them to strong keys',()=>{
 for(const firmableId of ['fake-provider-id','F123','f12x',' f123 '])expect(()=>normalizeCompanyIdentity({...source,firmableId})).toThrow();
 });
 it('reuses one target and automatically selects a stable canonical target for exact provider duplicates',()=>{
 const s=normalizeCompanyIdentity(source),a={...s,targetId:'a'},b={...s,targetId:'b'};
 expect(classifyCompanyIdentity(s,[a])).toEqual({kind:'reuse',targetId:'a'});
 for(const candidates of [[a,b],[b,a],[{...s,targetId:'z'},b,a]])expect(classifyCompanyIdentity(s,candidates)).toEqual({kind:'reuse',targetId:'a'});
 });
 it('retains human review when duplicate candidates do not all share the source provider identity',()=>{
 const s=normalizeCompanyIdentity(source),a={...s,targetId:'a'},b={...s,targetId:'b',firmableId:undefined};
 expect(classifyCompanyIdentity(s,[a,b])).toEqual({kind:'review',reason:'consistent_existing_duplicates'});
 expect(classifyCompanyIdentity({...s,firmableId:undefined},[a,{...b,firmableId:'f1'}])).toEqual({kind:'review',reason:'consistent_existing_duplicates'});
 expect(classifyCompanyIdentity({...s,firmableId:undefined},[{...a,firmableId:undefined},b])).toEqual({kind:'review',reason:'consistent_existing_duplicates'});
 });
 it('does not let a shared provider ID override conflicting domains, ABNs or invalid candidates',()=>{
 const s=normalizeCompanyIdentity(source),a={...s,targetId:'a'};
 for(const changed of [{...s,domain:'another.example'},{...s,abn:'99999999999'},{...s,firmableId:'f2'},{...s,firmableId:'invalid'}])expect(classifyCompanyIdentity(s,[a,{...changed,targetId:'b'}])).toEqual({kind:'review',reason:'conflicting_identifiers'});
 });
 it('never resolves contradictory identifiers by choosing the first domain match',()=>{
 const s=normalizeCompanyIdentity(source);
 expect(classifyCompanyIdentity(s,[{...s,targetId:'a',firmableId:'f2'}])).toEqual({kind:'review',reason:'conflicting_identifiers'});
 expect(classifyCompanyIdentity(s,[{...s,targetId:'a',abn:'99999999999'}])).toEqual({kind:'review',reason:'conflicting_identifiers'});
 });
 it('does not treat contradictory candidate FIDs as consistent when the new observation has no FID',()=>{
 const s=normalizeCompanyIdentity({companyName:'Example',domain:'example.test'});
 expect(classifyCompanyIdentity(s,[{...s,targetId:'a',firmableId:'f1'},{...s,targetId:'b',firmableId:'f2'}])).toEqual({kind:'review',reason:'conflicting_identifiers'});
 });
 it('permits a prior audited canonical claim only among consistent current candidates',()=>{
 const s=normalizeCompanyIdentity(source),a={...s,targetId:'a'},b={...s,targetId:'b'};
 expect(classifyCompanyIdentity(s,[a,b],'b')).toEqual({kind:'reuse',targetId:'b'});
 expect(classifyCompanyIdentity(s,[a,b],'foreign')).toEqual({kind:'review',reason:'conflicting_identifiers'});
 });
 it('does not equate absent identifiers or create a hidden 51st choice',()=>{
 const s=normalizeCompanyIdentity(source);
 expect(classifyCompanyIdentity(s,[])).toEqual({kind:'create'});
 expect(()=>classifyCompanyIdentity(s,Array.from({length:51},(_,i)=>({...s,targetId:String(i)})))).toThrow('too many');
 });
});
