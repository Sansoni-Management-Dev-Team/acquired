import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FirmableAccount} from '../dist/firmable-account.mjs';
import {config} from '../src/config.mjs';
const credentials={FIRMABLE_CLIENT_COOKIE:'synthetic-cookie-value-long-enough',FIRMABLE_SESSION_ID:'sess_test',FIRMABLE_ORGANIZATION_ID:'org_test',FIRMABLE_CREDENTIAL_KEY:'a'.repeat(32)};
function setup(country) {
 const state=new Map(),calls=[];
 const storage={get:async key=>state.get(key),put:async(key,value)=>state.set(key,structuredClone(value))};
 const fetcher=async(url,options)=>{
  if(String(url).startsWith('https://clerk.firmable.com/')){const claims={sid:'sess_test',o:{id:'org_test'},exp:Math.floor(Date.now()/1000)+60};return Response.json({jwt:`e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`})}
  calls.push(JSON.parse(options.body));return Response.json({success:true,records:[],totalCompany:0});
 };
 return{calls,account:new FirmableAccount(storage,{...credentials,...(country?{FIRMABLE_SEARCH_COUNTRY:country}:{})},fetcher)};
}
const search=body=>({path:'/company/search',method:'POST',query:{},body});

test('local service explicitly configures Australia for Firmable company search',()=>{
 const env=config({RESEARCH_DATABASE_URL:'postgresql://research:password@database/acquire_research_local',RESEARCH_APP_ORIGIN:'http://127.0.0.1:3100',RESEARCH_SERVICE_SECRET:'s'.repeat(32)});
 assert.equal(env.FIRMABLE_SEARCH_COUNTRY,'AU');
});
test('first AI discovery request has a structured Australia country filter',async()=>{
 const {account,calls}=setup('AU');const query='Aged care software support companies';
 assert.equal((await account.handle(search({query}))).status,200);
 assert.deepEqual(calls[0].filters,{country:{AU:'Australia'}});assert.deepEqual(calls[0].operators,{country:'OR'});assert.equal(calls[0].query,query);assert.equal(calls[0].mode,'ai');
});
test('continuation keeps non-country filters and explicitly retains Australia',async()=>{
 const {account,calls}=setup('AU');const interpreted={filters:{industry:{id:'Software'},company_size:{'2':'11-50'}},operators:{industry:'OR'},excluded:{keywords:{id:'Recruitment'}}};
 assert.equal((await account.handle(search({from:100,interpreted}))).status,200);
 assert.deepEqual(calls[0].filters,{...interpreted.filters,country:{AU:'Australia'}});assert.deepEqual(calls[0].excluded,interpreted.excluded);assert.equal(calls[0].operators.country,'OR');assert.equal(calls[0].ai_search,undefined);assert.equal(interpreted.filters.country,undefined);
});
test('conflicting continuation countries cannot escape the local Australia scope',async()=>{
 for(const interpreted of [{filters:{country:{US:'United States'}},operators:{},excluded:{}},{filters:{},operators:{},excluded:{country:{AU:'Australia'}}}]){
  const {account,calls}=setup('AU');const result=await account.handle(search({from:100,interpreted}));assert.equal(result.status,400);assert.equal(result.body.category,'country_scope_conflict');assert.equal(calls.length,0);
 }
});
test('unconfigured shared transport retains its existing search behavior',async()=>{
 const {account,calls}=setup();assert.equal((await account.handle(search({query:'Packaging companies'}))).status,200);assert.deepEqual(calls[0].filters,{});assert.deepEqual(calls[0].operators,{});
});
