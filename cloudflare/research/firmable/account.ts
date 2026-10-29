import {firmableOutageResponse} from './local-outage';
import {safeResearchTrace,safeResearchFailure,type ResearchTraceContext} from '../../../src/domain/research-trace-context';
import {withoutFirmablePersonPhones} from '../../../src/domain/firmable-person-privacy';
import {nativeFirmableBudgetFetch,type NativeFirmableContext,type NativeFirmableBudgetEnv} from '../native-firmable-budget';
import type { FirmableSessionEnv } from '../firmable-session-validation';
import { seal, unseal, validCredentials, type Credentials } from './credentials';
import { domain, normalize, ServiceError, upstream, type RecordData } from './transport';
import { expandCompanyProfile } from './company';
export interface FirmableServiceEnv extends FirmableSessionEnv,NativeFirmableBudgetEnv { FIRMABLE_SERVICE_SECRET?: string; FIRMABLE_CREDENTIAL_KEY?: string; FIRMABLE_SESSION_TOKEN?: string; FIRMABLE_SEARCH_COUNTRY?: string }
export type ServiceInput = { path: string; method: string; query: Record<string, string>; body?: RecordData; nativeResearch?: NativeFirmableContext; traceContext?: ResearchTraceContext };
type AccountStorage={get<T=unknown>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<void>};
type State = { credentials?: Awaited<ReturnType<typeof seal>>; reconnectRequired?: boolean; cooldownUntil?: number; nextRequestAt?: number; requestSpacingMs?: number };
// The optional browser JWT is a renewal hint, never authentication authority.
// Expired/foreign hints can make Clerk reject an otherwise valid cookie renewal.
function freshRenewalHint(credentials:Credentials):string|undefined {
  if(!credentials.sessionToken)return;
  try {
    const encoded=credentials.sessionToken.split('.')[1].replaceAll('-','+').replaceAll('_','/');
    const claims=JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length/4)*4,'=')));
    if(claims?.sid===credentials.sessionId&&claims?.o?.id===credentials.organizationId&&typeof claims.exp==='number'&&Number.isFinite(claims.exp)&&claims.exp*1000>Date.now()+10_000)return credentials.sessionToken;
  }catch{ /* Cookie-only renewal remains subject to strict upstream verification. */ }
}
export class FirmableAccount {
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private token?: { jwt: string; expiresAt: number };
  constructor(private storage: AccountStorage, private env: FirmableServiceEnv, private fetcher: typeof fetch = fetch) {}
  async handle(input: ServiceInput) {
    const started=Date.now(),trace=safeResearchTrace(input.traceContext);
    const log=(event:string,fields:Record<string,unknown>={})=>console.info('firmable-account',JSON.stringify({module:'firmable.account',event,timestamp:new Date().toISOString(),...trace,...fields,elapsedMs:Date.now()-started}));
    const paused=firmableOutageResponse(this.env,input.path);
    if(paused){log('request_paused',{category:paused.body.category,httpStatus:paused.status});return paused;}
    log('request_started',{operation:['/status','/reconnect','/company','/company/search','/people','/people/search','/people/phones'].includes(input.path)?input.path:'unsupported',method:['GET','POST'].includes(input.method)?input.method:'unsupported'});
    if (this.pending >= 10) {log('queue_rejected',{pending:this.pending,httpStatus:429,category:'service_busy'});log('request_failed',{httpStatus:429,category:'service_busy'});log('request_finished',{outcome:'failed',httpStatus:429,category:'service_busy'});return { status: 429, body: { category: 'service_busy' }, retryAfter: 10 };}
    this.pending++;log('queue_entered',{pending:this.pending});
    const result = this.queue.then(() => {log('queue_started',{queueWaitMs:Date.now()-started});return this.execute(input,log);}).catch(error => {
      log('request_failed',{...safeResearchFailure(error),httpStatus:error instanceof ServiceError?error.status:502,category:error instanceof ServiceError?error.category:'service_unavailable'});
      return { status: error instanceof ServiceError ? error.status : 502,
        body: { error: error instanceof ServiceError ? error.category : 'service_unavailable', category: error instanceof ServiceError ? error.category : 'service_unavailable' },
        retryAfter: error instanceof ServiceError ? Math.ceil(error.retryAfter / 1000) : 0 };
    });
    this.queue = result;
    try {const response=await result;log('request_finished',{outcome:response.status<400?'succeeded':'failed',httpStatus:response.status});return response;} finally { this.pending--; }
  }
  private async execute(input: ServiceInput,log:(event:string,fields?:Record<string,unknown>)=>void): Promise<{ status: number; body: RecordData; retryAfter?: number }> {
    const fetcher=input.nativeResearch?nativeFirmableBudgetFetch(this.env,input.nativeResearch,this.fetcher,this.fetcher):this.fetcher;
    const state = await this.storage.get<State>('firmable:state') || {};
    const save = () => this.storage.put('firmable:state', state);
    const spacing=()=>typeof state.requestSpacingMs==='number'&&Number.isFinite(state.requestSpacingMs)&&state.requestSpacingMs>=1000?Math.min(30000,state.requestSpacingMs):1000;
    const recordCooldown=async(error:ServiceError)=>{
      // Only an authenticated upstream rate-limit response changes persisted pacing.
      if(error.status!==429||error.category!=='rate_limited')return;
      state.requestSpacingMs=Math.min(30000,spacing()*2);
      state.cooldownUntil=Math.max(state.cooldownUntil||0,Date.now()+error.retryAfter);
      state.nextRequestAt=Math.max(state.nextRequestAt||0,state.cooldownUntil+state.requestSpacingMs);
      log('cooldown_started',{retryAfterMs:error.retryAfter,requestSpacingMs:state.requestSpacingMs});await save();
    };
    if (input.path === '/status') return { status: 200, body: { configured: Boolean(this.env.FIRMABLE_CREDENTIAL_KEY && (state.credentials || this.env.FIRMABLE_CLIENT_COOKIE)), reconnectRequired: Boolean(state.reconnectRequired), cooldownUntil: state.cooldownUntil || null, tokenExpiresAt: this.token?.expiresAt || null } };
    if (input.path === '/reconnect') {
      const credentials = input.body as unknown as Credentials;
      if (!credentials || !validCredentials(credentials)) throw new ServiceError(400, 'invalid_credentials');
      if (this.env.FIRMABLE_ORGANIZATION_ID && credentials.organizationId !== this.env.FIRMABLE_ORGANIZATION_ID) throw new ServiceError(400, 'unexpected_organization');
      await this.renew(credentials, state,fetcher,log);
      state.credentials = await seal(credentials, this.env.FIRMABLE_CREDENTIAL_KEY || '');
      state.reconnectRequired = false;
      await save();
      return { status: 200, body: { connected: true } };
    }
    if (state.cooldownUntil && state.cooldownUntil > Date.now()) {log('cooldown_active',{retryAfterMs:state.cooldownUntil-Date.now(),requestSpacingMs:spacing()});throw new ServiceError(429, 'rate_limited', state.cooldownUntil - Date.now());}
    if (state.reconnectRequired) throw new ServiceError(401, 'reconnect_required');
    if (!this.env.FIRMABLE_CREDENTIAL_KEY) throw new ServiceError(503, 'not_configured');
    const credentials = state.credentials ? await unseal(state.credentials, this.env.FIRMABLE_CREDENTIAL_KEY) : {
      cookie: this.env.FIRMABLE_CLIENT_COOKIE || '', sessionId: this.env.FIRMABLE_SESSION_ID || '', organizationId: this.env.FIRMABLE_ORGANIZATION_ID || '', sessionToken:this.env.FIRMABLE_SESSION_TOKEN };
    if (!validCredentials(credentials)) throw new ServiceError(503, 'not_configured');
    const request = async (path: string, body?: RecordData): Promise<RecordData> => {
      const delay = Math.max(0, (state.nextRequestAt || 0) - Date.now());
      if (delay) {log('pacing_wait',{delayMs:delay,requestSpacingMs:spacing()});await new Promise(resolve => setTimeout(resolve, delay));}
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (!this.token || this.token.expiresAt - 10_000 <= Date.now()) { await this.renew(credentials, state,fetcher,log); await save(); }
          state.nextRequestAt = Date.now() + spacing();
          await save();
          const attemptStarted=Date.now();log('upstream_attempt_started',{attempt:attempt+1,operation:path.startsWith('/company/')?'company_profile':path.startsWith('/people/')?'people_profile':path==='/people'?'people_search':'company_search'});
          const result=await upstream(fetcher, `https://api.firmable.com/internal${path}`, { method: body ? 'POST' : 'GET',
            headers: { Authorization: `Bearer ${this.token!.jwt}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
          log('upstream_attempt_finished',{attempt:attempt+1,outcome:'complete',durationMs:Date.now()-attemptStarted});return result.data;
        } catch (error) {
          log('upstream_attempt_failed',{attempt:attempt+1,...safeResearchFailure(error),httpStatus:error instanceof ServiceError?error.status:502,category:error instanceof ServiceError?error.category:'service_unavailable'});
          if (error instanceof ServiceError && error.category === 'upstream_authentication' && attempt === 0) { this.token = undefined; continue; }
          throw error;
        }
      }
      throw new ServiceError(401, 'reconnect_required');
    };
    try {
      let data: RecordData;
      if (input.path === '/company/search') {
        const body=input.body||{},from=Number(body.from??0),size=Number(body.size??100);
        if(!Number.isInteger(from)||from<0||from>10000||!Number.isInteger(size)||size<1||size>100)throw new ServiceError(400,'invalid_pagination');
        const interpreted=body.interpreted as RecordData|undefined;
        if(from===0&&(typeof body.query!=='string'||!body.query.trim()||body.query.length>10000))throw new ServiceError(400,'invalid_query');
        if(from>0&&(!interpreted||['filters','operators','excluded'].some(k=>!interpreted[k]||typeof interpreted[k]!=='object'||Array.isArray(interpreted[k]))))throw new ServiceError(400,'interpreted_filters_required');
        const parameters:RecordData={from,size,category:'company',metadata:{},sorting:{company:{},people:{}},search:{company:{},people:{}},...(from===0?{query:body.query,mode:'ai',ai_search:{do_search:true},filters:{},operators:{},excluded:{}}:{filters:interpreted!.filters,operators:interpreted!.operators,excluded:interpreted!.excluded})};
        // The standalone local service pins AU before the request reaches either
        // the ordinary transport or the native budget/receipt adapter. Other
        // deployments retain their existing behavior unless explicitly configured.
        if(this.env.FIRMABLE_SEARCH_COUNTRY){
          if(this.env.FIRMABLE_SEARCH_COUNTRY!=='AU')throw new ServiceError(503,'invalid_country_configuration');
          const filters=parameters.filters as RecordData,operators=parameters.operators as RecordData,excluded=parameters.excluded as RecordData;
          const country=filters.country,negative=excluded.country;
          if(country!==undefined&&(!country||typeof country!=='object'||Array.isArray(country)||Object.keys(country).some(key=>key!=='AU')||Object.hasOwn(country,'AU')&&(country as RecordData).AU!=='Australia'))throw new ServiceError(400,'country_scope_conflict');
          if(operators.country!==undefined&&operators.country!=='OR'||negative!==undefined&&(!negative||typeof negative!=='object'||Array.isArray(negative)||Object.hasOwn(negative,'AU')))throw new ServiceError(400,'country_scope_conflict');
          parameters.filters={...filters,country:{AU:'Australia'}};
          parameters.operators={...operators,country:'OR'};
        }
        data=await request('/records/v2',parameters);
        if(data.success!==true||!Array.isArray(data.records)||typeof data.totalCompany!=='number')throw new ServiceError(502,'invalid_upstream_response');
      } else if (input.path === '/company') {
        let id = input.query.id;
        if (!id) {
          const expectedDomain = domain(input.query.fqdn || input.query.website || '');
          if (!expectedDomain) throw new ServiceError(422, 'unsupported_identifier');
          const queries = [...new Set([input.query.name, expectedDomain.split('.')[0]].filter(Boolean))];
          for (const query of queries) {
            const search = await request('/records/v2', { from: 0, size: 100, filters: { country: { AU: 'Australia' } }, operators: {}, excluded: {}, sorting: { company: {}, people: {} }, search: { company: { name: query }, people: {} }, category: 'company', metadata: {} });
            if (search.success === false && search.totalCompany === 0 && (search.records === undefined || Array.isArray(search.records) && search.records.length === 0)) continue;
            if (!Array.isArray(search.records)) throw new ServiceError(502, 'invalid_upstream_response');
            const matches = (search.records as RecordData[]).filter(row => typeof row.website === 'string' && domain(row.website) === expectedDomain);
            if (matches.length > 1) throw new ServiceError(409, 'ambiguous_company');
            if (matches.length === 1) { id = String(matches[0].id); break; }
          }
          if (!id) throw new ServiceError(404, 'company_not_found');
        }
        if (!/^f\d+$/.test(id)) throw new ServiceError(400, 'invalid_company_id');
        const country = input.query.country || 'AU';
        if (!/^[A-Z]{2}$/.test(country)) throw new ServiceError(400, 'invalid_country');
        data = expandCompanyProfile(await request(`/company/${id}`), country);
        if (data.id !== id) throw new ServiceError(502, 'unexpected_company_response');
        if (input.query.includePeople === 'true') {
          try {
            const people = await request('/people', {companyId:id, companyName:data.name, selectedCountry:country, from:0, size:1});
            const empty = people.success === false && people.totalPeople === 0 && (!people.records || Array.isArray(people.records) && people.records.length === 0);
            if (!empty && (people.success !== true || !Array.isArray(people.records) || typeof people.total !== 'number' || !Number.isInteger(people.total) || people.total < 0)) throw new ServiceError(502, 'invalid_upstream_response');
            data.available_people_count = empty ? 0 : people.total;
            data.people_summary = {status:'complete', country, total:data.available_people_count, retrieved_at:new Date().toISOString()};
          } catch (error) {
            // A summary failure must not discard a successfully retrieved company.
            data.people_summary = {status:'failed', country, category:error instanceof ServiceError ? error.category : 'service_unavailable', retrieved_at:new Date().toISOString()};
            if (error instanceof ServiceError && error.status === 429) await recordCooldown(error);
            if (error instanceof ServiceError && [401,403].includes(error.status)) { state.reconnectRequired = true; await save(); }
          }
        }
      } else if (input.path === '/people/search') {
        const body = input.body || {};
        if (typeof body.companyId !== 'string' || !/^f\d+$/.test(body.companyId)) throw new ServiceError(400, 'invalid_company_id');
        if (body.seniority || body.department) throw new ServiceError(422, 'unsupported_filter');
        const size = Number(body.size ?? 100), from = Number(body.from ?? 0);
        if (!Number.isInteger(size) || size < 1 || size > 100 || !Number.isInteger(from) || from < 0 || from > 10_000) throw new ServiceError(400, 'invalid_pagination');
        data = await request('/people', { companyId: body.companyId, selectedCountry: 'AU', size, from, ...(body.position ? { search: { position: body.position } } : {}) });
        if (data.success === false && data.totalPeople === 0 && (!data.records || Array.isArray(data.records) && data.records.length === 0)) data = {success:true,records:[],total:0,browserResponse:data};
        if (data.success !== true || !Array.isArray(data.records) || typeof data.total !== 'number') throw new ServiceError(502, 'invalid_upstream_response');
        data = { ...data, records: (data.records as RecordData[]).map(normalize) };
      } else if (input.path === '/people/phones') {
        const id = input.body?.id;
        if (typeof id !== 'string' || !/^fp\d+$/.test(id) || input.body?.confirmCredits !== true) throw new ServiceError(400, 'phone_lookup_requires_explicit_action');
        const available = await request(`/people/${id}/phones/new`);
        if (!Array.isArray(available.phones) || typeof available.hasViewedPhonesAlready !== 'boolean') throw new ServiceError(502, 'invalid_upstream_response');
        const disclosed = (available.phones as RecordData[]).some(phone => typeof phone.value === 'string' && !/[*x•]/i.test(phone.value) && phone.value.replace(/\D/g, '').length >= 7);
        const phones = !available.phones.length || available.hasViewedPhonesAlready && disclosed ? available : await request(`/people/${id}/phones/show`);
        if (!Array.isArray(phones.phones)) throw new ServiceError(502, 'invalid_upstream_response');
        data = { id, phones: phones.phones };
      } else if (input.path === '/people') {
        if (!/^fp\d+$/.test(input.query.id || '')) throw new ServiceError(422, 'unsupported_identifier');
        data = normalize(await request(`/people/${input.query.id}`));
        if (input.query.includePhones === 'false')data=withoutFirmablePersonPhones(data);
      } else throw new ServiceError(404, 'not_found');
      return { status: 200, body: data };
    } catch (error) {
      if (error instanceof ServiceError && error.status === 429) await recordCooldown(error);
      if (error instanceof ServiceError && [401, 403].includes(error.status)) { state.reconnectRequired = true; this.token = undefined; await save(); throw new ServiceError(401, 'reconnect_required'); }
      throw error;
    }
  }
  private async renew(credentials: Credentials, state: State,fetcher:typeof fetch=this.fetcher,log:(event:string,fields?:Record<string,unknown>)=>void=()=>{}) {
    const started=Date.now();log('renewal_started');
    try{
    const hint=freshRenewalHint(credentials);
    const result = await upstream(fetcher, `https://clerk.firmable.com/v1/client/sessions/${credentials.sessionId}/tokens?__clerk_api_version=2026-05-12&_clerk_js_version=6.36.0`, {
      method: 'POST', headers: { Cookie: `__client=${credentials.cookie}`, Origin: 'https://app.firmable.com', Referer: 'https://app.firmable.com/', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ organization_id: credentials.organizationId, tab_state: 'visible', ...(hint?{token:hint}:{}) }).toString() });
    const jwt = result.data.jwt;
    if (typeof jwt !== 'string') throw new ServiceError(502, 'invalid_token_response');
    let claims: RecordData;
    try { claims = JSON.parse(atob(jwt.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))); } catch { throw new ServiceError(502, 'invalid_token_response'); }
    if (claims.sid !== credentials.sessionId || (claims.o as RecordData)?.id !== credentials.organizationId || typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now() + 10_000) throw new ServiceError(502, 'unexpected_token_context');
    const cookies = result.headers.get('set-cookie') || '';
    const rotated = cookies.match(/(?:^|,\s*)__client=([^; ,]*)/);
    if (rotated) {
      if (!rotated[1]) throw new ServiceError(401, 'reconnect_required');
      credentials.cookie = rotated[1];
      state.credentials = await seal(credentials, this.env.FIRMABLE_CREDENTIAL_KEY || '');
    }
    credentials.sessionToken=jwt;
    state.credentials=await seal(credentials,this.env.FIRMABLE_CREDENTIAL_KEY||'');
    this.token = { jwt, expiresAt: claims.exp * 1000 };
    log('renewal_finished',{outcome:'complete',durationMs:Date.now()-started,rotatedCookie:Boolean(rotated)});
    }catch(error){log('renewal_failed',{...safeResearchFailure(error),durationMs:Date.now()-started});throw error;}
  }
}
