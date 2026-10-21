import {expect,it} from 'vitest';
import type {ResearchConfig} from './research';
import {buildAllDiscoveredCompanyPolicy,buildCompanyDiscoveryPolicy} from './research-discovery-policy';
import {companyDiscoveryProgress,projectCompanyDiscoveryConfig} from './company-discovery-progress';

function config(values:Record<string,unknown>={}):ResearchConfig{return{pipelineDesign:'hybrid-firmable-v1',companyDiscoveryPolicy:buildAllDiscoveredCompanyPolicy(),...values} as unknown as ResearchConfig;}

it('reports saved discoveries before any company profile exists, independently of provider totals, and projects out only raw discovery pages',()=>{
 const original=config({firmableSearchPages:{0:{records:[{id:'f1',website:'https://one.example.com'},{id:'f2'}],totalCompany:90000}},newBusinessIds:[],otherSavedEvidence:{value:'retained'}});
 expect(companyDiscoveryProgress(original)).toEqual({candidates:2,firmablePages:1,webQueries:0,webFailures:0});
 const next=config({...original,webSearchPages:{0:{ok:true,rows:[{domain:'one.example.com'},{domain:'new.example.com'}]}}});
 expect(companyDiscoveryProgress(next)).toEqual({candidates:3,firmablePages:1,webQueries:1,webFailures:0});
 const projected=projectCompanyDiscoveryConfig(next) as ResearchConfig&Record<string,unknown>;
 expect(projected.firmableSearchPages).toBeUndefined();expect(projected.webSearchPages).toBeUndefined();
 expect(projected).toEqual({...original,webSearchPages:undefined,firmableSearchPages:undefined});
 expect((original as ResearchConfig&Record<string,unknown>).firmableSearchPages).toBeDefined();
});

it('deduplicates page overlaps and normalized web domains while retaining conflicting Firmable IDs and first-observed website facts',()=>{
 const input=config({firmableSearchPages:{100:{records:[{id:'f2',website:'https://changed.example.com'},{id:'f4',fqdn:'fresh.example.com'}]},0:{records:[{id:'f1',website:'https://www.SHARED.example.com/path'},{id:'f2',website:'shared.example.com'},{id:'f3'},{id:'f3',website:'https://later.example.com'},{id:'invalid',website:'ignored.example.com'}]}},webSearchPages:{0:{ok:true,rows:[{domain:'https://www.shared.example.com/'},{domain:'fresh.example.com'},{domain:'WEB.example.com'},{domain:'https://www.web.example.com/path'},{domain:'later.example.com'}]}}});
 expect(companyDiscoveryProgress(input)).toEqual({candidates:6,firmablePages:2,webQueries:1,webFailures:0});
});

it('uses saved page and row bounds rather than a profile shortlist or unseen provider match totals',()=>{
 const firmable={0:{totalCompany:999999,records:Array.from({length:101},(_,i)=>({id:'f'+(i+1)}))},100:{records:Array.from({length:100},(_,i)=>({id:'f'+(i+101)}))},200:{records:[{id:'f999'}]}};
 const web={0:{ok:true,rows:Array.from({length:101},(_,i)=>({domain:`web${i}.example.com`}))},1:{ok:false,rows:[]},6:{ok:true,rows:[{domain:'outside.example.com'}]}};
 expect(companyDiscoveryProgress(config({firmableSearchPages:firmable,webSearchPages:web}))).toEqual({candidates:300,firmablePages:2,webQueries:2,webFailures:1});
 expect(companyDiscoveryProgress(config({companyDiscoveryPolicy:buildCompanyDiscoveryPolicy(),firmableSearchPages:firmable})).candidates).toBe(200);
});

it('does not invent found businesses for empty/failed pages or malformed saved row values',()=>{
 expect(companyDiscoveryProgress(config())).toEqual({candidates:0,firmablePages:0,webQueries:0,webFailures:0});
 expect(companyDiscoveryProgress(config({firmableSearchPages:{0:{records:[null,{id:'bad'},{}],totalCompany:1000}},webSearchPages:{0:{ok:false,rows:[]},1:{ok:true,rows:[null,{}, {domain:'https://[invalid'}]}}}))).toEqual({candidates:0,firmablePages:1,webQueries:2,webFailures:1});
});

it('counts only unique reviewed saved identities for a continuation instead of claiming fresh discovery',()=>{
 const input=config({companyContinuation:{version:1,sourceRootId:'00000000-0000-4000-8000-000000000001',sourceDigest:'a'.repeat(64),candidateKeys:['firmable:f1','firmable:f1','domain:one.example.com']},firmableSearchPages:{0:{records:[{id:'f99'}]}},webSearchPages:{0:{ok:false,rows:[]}}});
 expect(companyDiscoveryProgress(input)).toEqual({candidates:2,firmablePages:0,webQueries:0,webFailures:0});
});
