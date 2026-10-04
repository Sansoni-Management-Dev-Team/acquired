import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import pg from 'pg';
import {localBenchmarkDatabase} from './research-design-metrics.mjs';
import {abnChecksum} from '../src/domain/abn-public-lookup.mjs';
const directory=resolve(process.argv[2]||'');
const manifest=JSON.parse(readFileSync(resolve(directory,'manifest.json')));
const final=JSON.parse(readFileSync(resolve(directory,'final.json')));
if(manifest.design!=='D'||!final.summary.finished)throw Error('Requires a completed D benchmark');
const client=new pg.Client({connectionString:localBenchmarkDatabase(manifest.databaseName)});
try{
 await client.connect();await client.query('SET default_transaction_read_only=on');
 const root=(await client.query('SELECT organization_id,mandate_id,config,status FROM research_jobs WHERE id=$1',[final.summary.rootId])).rows[0];
 const jobs=(await client.query("SELECT id,status,config,message FROM research_jobs WHERE organization_id=$1 AND config->>'researchRunId'=$2",[root.organization_id,final.summary.rootId])).rows;
 const targets=(await client.query('SELECT id,domain,identifiers,firmographics FROM targets WHERE organization_id=$1 AND mandate_id=$2',[root.organization_id,root.mandate_id])).rows;
 const mandate=(await client.query('SELECT filters FROM mandates WHERE id=$1',[root.mandate_id])).rows[0].filters;
 const criteria=mandate.brief?.criteria?.find(c=>c.key==='revenue')?.value?.match(/(\d+)\D+(\d+)/);
 const range=criteria?{min:Number(criteria[1]),max:Number(criteria[2])}:mandate.revenue;
 const companies=jobs.filter(j=>j.config.researchTask==='company'),profiles=companies.filter(j=>j.config.firmableProfile),n=targets.length;
 const count=key=>targets.filter(t=>key==='abn'?abnChecksum(t.identifiers?.abn||''):key==='reportedHeadcount'?t.firmographics.headcount?.value!=null:key==='headcountBand'?t.firmographics.headcountBand?.value!=null:t.firmographics.revenue?.value?.kind==='band').length;
 const coverage=Object.fromEntries(['abn','reportedHeadcount','headcountBand','revenueBand'].map(key=>{const found=count(key);return[key,{found,total:n,percent:n?Math.round(found/n*1000)/10:0}]}));
 const resolutionSources={},lookups={},abnMatchDiagnostics={},exclusionReasons={},checks={finished:final.summary.finished,noActiveJobs:jobs.every(j=>['complete','partial','failed','cancelled'].includes(j.status)),noFailedCompanies:companies.every(j=>j.status==='complete'),uniqueDomains:new Set(targets.map(t=>t.domain)).size===n,profilePersistence:n===profiles.length,revenueScreening:true,headcountFromProfile:true,acceptedAbnsVerified:true,conflictingAbnsWithheld:true};
 for(const j of profiles){const lookupResult=j.config.abnLookup;const target=targets.find(t=>t.id===j.config.targetId);const accepted=target?.identifiers?.abn;checks.acceptedAbnsVerified&&=!accepted||(lookupResult?.status==='matched'&&lookupResult.abn===accepted&&lookupResult.record?.abn===accepted&&lookupResult.record.active===true&&lookupResult.evidence?.length>0);checks.conflictingAbnsWithheld&&=!['conflict','ambiguous'].includes(lookupResult?.status)||!accepted;const source=lookupResult?.resolutionSource||'unknown';resolutionSources[source]=(resolutionSources[source]||0)+1;const p=j.config.firmableProfile,b=p.revenueBand;const expected=!b?'review':b.min>range.max||(b.max??Infinity)<range.min?'excluded':b.min>=range.min&&(b.max??Infinity)<=range.max?'supported':'review';checks.revenueScreening&&=expected===j.config.screening.revenue;checks.headcountFromProfile&&=p.headcountExact===p.rawResponse.employee_count;const lookup=j.config.abnLookup?.status||(p.abn?'profile_abn':'lookup_error');lookups[lookup]=(lookups[lookup]||0)+1;if(lookup==='exact_name_match'){const match=j.config.abnLookup.match;const category=match.nameType!=='Entity Name'?'business_or_trading_name':!p.states.some(state=>match.location.toUpperCase().includes(state.toUpperCase()))?'entity_name_without_compatible_state':'accepted_entity_name_and_state';abnMatchDiagnostics[category]=(abnMatchDiagnostics[category]||0)+1;}for(const[k,v]of Object.entries(j.config.screening||{}))if(v==='excluded')exclusionReasons[k]=(exclusionReasons[k]||0)+1;}
 const report={valid:Object.values(checks).every(Boolean),checks,rootStatus:root.status,elapsedMs:final.summary.elapsedMs,jobs:jobs.length,profiles:profiles.length,companies:n,coverage,lookups,resolutionSources,abnMatchDiagnostics,exclusionReasons,qualifiedCompanies:final.summary.qualifiedCompanies,capabilities:{people:'not_requested',email:'not_requested'},rootResult:root.config.firmableResult};
 writeFileSync(resolve(directory,'profile-verification.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report,null,2));if(!report.valid)process.exitCode=1;
}finally{await client.end();}
