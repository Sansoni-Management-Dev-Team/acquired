import {writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {resolvePublicCompanyAbn} from '../src/adapters/abn-identity-resolver';
const companies=[
 {name:'TDG Environmental',website:'https://tdgenvironmental.com',abn:'17130467346'},
 {name:'Industrial Cleaning Services',website:'https://cleaneroo.com.au',abn:'67612487242'},
 {name:'Industrial Cleaning Australia-Wide',website:'https://afhservices.com.au',abn:'86643387213'},
 {name:'Waste Management Services Sydney',website:'https://envirowaste.com.au',abn:'66613987438'},
 {name:'Waste Management Services Melbourne',website:'https://simplexwastesolutions.com.au',abn:'72649717322'}
];
it.runIf(process.env.RUN_ABN_LIVE==='true')('verifies five audit recoveries through live public website and registry reads',async()=>{
 const results=await Promise.all(companies.map(async company=>({company,...await resolvePublicCompanyAbn(company)})));
 if(process.env.ABN_LIVE_REPORT)writeFileSync(process.env.ABN_LIVE_REPORT,JSON.stringify(results,null,2),{mode:0o600});
 for(const result of results)expect(result.abn,`${result.company.name}: ${result.status} ${JSON.stringify(result.errors)}`).toBe(result.company.abn);
},60000);
