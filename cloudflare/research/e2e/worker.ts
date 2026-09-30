/** Test-only entrypoint: imports the actual research worker and Workflows. */
import productionWorker, { AcquireResearch as RealAcquireResearch, FirmableRefresh as RealFirmableRefresh, ProviderCoordinator } from '../index';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { createFixtureFetch, type FixtureEnv } from '../../../tests/research-e2e/transport';
const nativeFetch = globalThis.fetch.bind(globalThis);
let installedOrigins: string | undefined;
function install(env: FixtureEnv) {
 const origins = JSON.stringify([env.APP_ORIGIN, env.E2E_FIXTURE_ORIGIN, env.E2E_READER_ORIGIN]);
 if (installedOrigins && installedOrigins !== origins) throw new Error('E2E transport origins cannot change within an isolate');
 if (!installedOrigins) { globalThis.fetch = createFixtureFetch(env,nativeFetch); installedOrigins=origins; }
}
export class AcquireResearch extends RealAcquireResearch {
 async run(event: WorkflowEvent<{jobId:string}>,step:WorkflowStep) { install(this.env as typeof this.env & FixtureEnv); return super.run(event,step); }
}
export class FirmableRefresh extends RealFirmableRefresh {
 async run(event: WorkflowEvent<{runId:string;mandateId:string}>,step:WorkflowStep) { install(this.env as typeof this.env & FixtureEnv); return super.run(event,step); }
}
export { ProviderCoordinator };
const worker = {
 async fetch(request:Request,env:Parameters<typeof productionWorker.fetch>[1] & FixtureEnv) {
  install(env);
  if (new URL(request.url).pathname === '/__reset-pages') {
   if (request.method !== 'POST' || !env.SERVICE_SECRET || request.headers.get('authorization') !== `Bearer ${env.SERVICE_SECRET}`) return Response.json({error:'Unauthorized'}, {status:403});
   let deleted=0;
   // Public test fixture pages only. Never enumerate/delete other cache entries.
   for(const slug of ['alpha','beta','gamma'])for(const path of ['/','/team','/about','/robots.txt','/sitemap.xml']) {
    const url=`https://${slug}.instruments.example.com${path}`;
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`public-page-v2:${url}`));
    const hash=Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
    if(await caches.default.delete(new Request(`https://research-cache.invalid/${hash}`)))deleted++;
   }
   return Response.json({ok:true,deleted});
  }
  if (new URL(request.url).pathname === '/__reserve') {
   if (request.method !== 'POST' || !env.SERVICE_SECRET || request.headers.get('authorization') !== `Bearer ${env.SERVICE_SECRET}`) return Response.json({error:'Unauthorized'}, {status:403});
   const body = await request.json().catch(() => null) as {jobId?:unknown;token?:unknown;provider?:unknown} | null;
   if (!body || typeof body.jobId !== 'string' || typeof body.token !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.jobId) || !/^[a-f0-9-]{36}$/i.test(body.token) || (body.provider !== undefined && body.provider !== 'search')) return Response.json({error:'Invalid test reservation'}, {status:400});
   const stub=env.PROVIDER_COORDINATOR?.getByName('account-wide');
   if (!stub) return Response.json({error:'Coordinator required'}, {status:503});
   return Response.json(await stub.reserve({jobId:body.jobId,token:body.token,provider:'search',holdMs:1000}));
  }
  return productionWorker.fetch(request,env);
 },
};

export default worker;
