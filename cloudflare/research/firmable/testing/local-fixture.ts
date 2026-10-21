/** Contract-test support only. Never compose this synthetic provider into the
 * production coordinator or attach it to an already approved GUI research job. */
import type {FirmableServiceEnv} from '../account';
import {ServiceError,type RecordData} from '../transport';
import {callbackOrigin} from '../../callback-origin';

export const LOCAL_FIRMABLE_FIXTURE_MODE='synthetic-v1' as const;
export const LOCAL_FIRMABLE_FIXTURE_NAMESPACE='firmable-account-local-fixture-v1' as const;
export type LocalFirmableFixtureEnv={LOCAL_DEVELOPMENT?:string;LOCAL_FIRMABLE_MODE?:string;APP_ORIGIN?:string;SERVICE_SECRET?:string};
const credentials={FIRMABLE_CLIENT_COOKIE:'OFFLINE_FIXTURE_COOKIE_NOT_A_REAL_CREDENTIAL',FIRMABLE_SESSION_ID:'sess_acquireFixtureV1',FIRMABLE_ORGANIZATION_ID:'org_acquireFixtureV1',FIRMABLE_CREDENTIAL_KEY:'offline-fixture-only-not-a-real-secret-key'} as const;
const provenance=Object.freeze({version:1,mode:LOCAL_FIRMABLE_FIXTURE_MODE,dataset:'commercial-refrigeration-qld-v1',synthetic:true});
const companies=Array.from({length:3},(_,i)=>{
 const ordinal=String(i+1).padStart(3,'0'),id='f990000000'+ordinal,host=`fixture-refrigeration-${ordinal}.example.invalid`;
 return Object.freeze({id,name:`Offline Fixture Refrigeration ${ordinal}`,website:`https://${host}`,description:'Synthetic commercial refrigeration maintenance and repair business serving Queensland commercial customers. Offline contract fixture; no genuine company or source observation.',hq_country:'AU',hq_location:'Brisbane QLD Australia',states:['QLD'],company_size:{'2':'11 - 50'},revenue:{'4':'AUD 4M - 12M'},employee_count:22,industries:{'1':'Commercial refrigeration services'},company_emails:[`info@${host}`],company_phones:[],region:{AU:{employee_count:22,company_size:{'2':'11 - 50'},revenue:{'4':'AUD 4M - 12M'},year_founded:2005,emails:[`info@${host}`],phones:[]}},offlineFixture:provenance});
});
const people=companies.map((company,i)=>Object.freeze({id:'fp990000000'+String(i+1).padStart(3,'0'),full_name:`Offline Fixture Owner ${String(i+1).padStart(3,'0')}`,position:'Managing Director',seniority:{'1':'Owner'},department:{'1':'Executive'},work_email:[{value:`owner@${new URL(company.website).hostname}`}],emails:{work:[{value:`owner@${new URL(company.website).hostname}`}]},phones:[],linkedin_url:'',email_available:true,phone_available:false,do_not_contact:false,company:{id:company.id,name:company.name,website:company.website},offlineFixture:provenance}));
function response(body:RecordData){return Response.json({...body,offlineFixture:provenance},{headers:{'x-acquire-offline-fixture':LOCAL_FIRMABLE_FIXTURE_MODE,'cache-control':'no-store'}});}
function body(input:RequestInit|undefined):RecordData{
 if(typeof input?.body!=='string')throw new ServiceError(400,'offline_fixture_body_required');
 let value:unknown;try{value=JSON.parse(input.body);}catch{throw new ServiceError(400,'offline_fixture_body_required');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ServiceError(400,'offline_fixture_body_required');return value as RecordData;
}
function page(rows:RecordData[],data:RecordData){const from=Number(data.from??0),size=Number(data.size??100);if(!Number.isInteger(from)||from<0||from>10000||!Number.isInteger(size)||size<1||size>100)throw new ServiceError(400,'offline_fixture_pagination_required');return rows.slice(from,from+size);}
export function localFirmableFixtureEnabled(env:LocalFirmableFixtureEnv){
 if(!env.LOCAL_FIRMABLE_MODE)return false;
 if(env.LOCAL_DEVELOPMENT!=='true'||env.LOCAL_FIRMABLE_MODE!==LOCAL_FIRMABLE_FIXTURE_MODE)throw new ServiceError(503,'offline_fixture_mode_not_allowed');return true;
}
/** The only delegated traffic is authenticated POSTs to the exact loopback app
 * research callback. All provider/renewal responses are generated in memory;
 * no external destination, unsupported lookup or reconnect can fall through. */
export function createLocalFirmableFixture(env:LocalFirmableFixtureEnv,callbackFetch:typeof fetch):{env:FirmableServiceEnv;fetch:typeof fetch;namespace:typeof LOCAL_FIRMABLE_FIXTURE_NAMESPACE}{
 if(!localFirmableFixtureEnabled(env))throw new ServiceError(503,'offline_fixture_mode_required');
 const origin=callbackOrigin(env.APP_ORIGIN||'',true),secret=env.SERVICE_SECRET;
 if(!secret)throw new ServiceError(503,'offline_fixture_callbacks_required');
 // Deliberately whitelist these two local fields: never read/copy real browser
 // cookies, token hints, encryption keys or real account state from the env.
 const syntheticEnv:FirmableServiceEnv={...credentials,APP_ORIGIN:origin,SERVICE_SECRET:secret};
 const fixtureFetch:typeof fetch=async(input,init)=>{
  if(typeof input!=='string'&&!(input instanceof URL))throw new ServiceError(400,'offline_fixture_request_not_allowed');
  const url=new URL(String(input)),method=init?.method??'GET';if(url.username||url.password||url.hash)throw new ServiceError(400,'offline_fixture_request_not_allowed');
  if(url.origin===origin){
   if(!/^\/api\/research\/internal\/[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(url.pathname)||url.search||method!=='POST'||new Headers(init?.headers).get('authorization')!==`Bearer ${secret}`)throw new ServiceError(400,'offline_fixture_callback_not_allowed');
   const payload=body(init);if(!['native-provider-begin','native-provider-finish'].includes(String(payload.action)))throw new ServiceError(400,'offline_fixture_callback_not_allowed');
   const result=await callbackFetch(input,{...init,redirect:'manual'});if(result.status>=300&&result.status<400){await result.body?.cancel();throw new ServiceError(502,'offline_fixture_callback_redirect_blocked');}return result;
  }
  if(url.origin==='https://clerk.firmable.com'){
   if(url.pathname!==`/v1/client/sessions/${credentials.FIRMABLE_SESSION_ID}/tokens`||method!=='POST'||new Headers(init?.headers).get('cookie')!==`__client=${credentials.FIRMABLE_CLIENT_COOKIE}`||new URLSearchParams(String(init?.body)).get('organization_id')!==credentials.FIRMABLE_ORGANIZATION_ID)throw new ServiceError(400,'offline_fixture_credentials_required');
   const claims={sid:credentials.FIRMABLE_SESSION_ID,o:{id:credentials.FIRMABLE_ORGANIZATION_ID},exp:Math.floor(Date.now()/1000)+3600};const encoded=btoa(JSON.stringify(claims)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');return response({jwt:`e30.${encoded}.offlineFixtureSignature`});
  }
  if(url.origin!=='https://api.firmable.com'||url.search)throw new ServiceError(400,'offline_fixture_upstream_blocked');
  if(url.pathname==='/internal/records/v2'&&method==='POST'){
   const data=body(init);if(data.category!=='company')throw new ServiceError(400,'offline_fixture_category_not_allowed');
   return response({success:true,records:page(companies,data),totalCompany:companies.length,predictedFilters:{filters:{country:{AU:'Australia'}},operators:{country:'OR'},excluded:{}},predictedCountry:{include:['AU'],operator:'OR'}});
  }
  if(url.pathname==='/internal/people'&&method==='POST'){
   const data=body(init),company=companies.find(item=>item.id===data.companyId);if(!company)throw new ServiceError(404,'offline_fixture_company_not_found');
   const records=people.filter(person=>person.company.id===company.id);return response({success:true,records:page(records,data),total:records.length});
  }
  const company=url.pathname.match(/^\/internal\/company\/(f\d+)$/);if(company&&method==='GET'){const found=companies.find(item=>item.id===company[1]);if(!found)throw new ServiceError(404,'offline_fixture_company_not_found');return response(found);}
  const person=url.pathname.match(/^\/internal\/people\/(fp\d+)$/);if(person&&method==='GET'){const found=people.find(item=>item.id===person[1]);if(!found)throw new ServiceError(404,'offline_fixture_person_not_found');return response(found);}
  // Phone-credit endpoints are intentionally absent, including new/show.
  throw new ServiceError(400,'offline_fixture_route_not_allowed');
 };
 return{env:syntheticEnv,fetch:fixtureFetch,namespace:LOCAL_FIRMABLE_FIXTURE_NAMESPACE};
}
