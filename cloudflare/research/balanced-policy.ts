import type { ResearchProvider } from '../../src/domain/research-provider-queue';
export function balancedReservation(provider: ResearchProvider, env: { LOCAL_DEVELOPMENT?: string; RESEARCH_PIPELINE_DESIGN?: string }) {
 const balancedLocal = env.LOCAL_DEVELOPMENT === 'true' && ['balanced-v1','corpus-v1'].includes(env.RESEARCH_PIPELINE_DESIGN || '');
 // Local rendered search and page reads use the very same five-browser reader.
 return { balancedLocal, provider: balancedLocal && provider === 'search' ? 'page' as const : provider };
}
export async function balancedWakeups(steps: { sleep(name:string,ms:number):Promise<unknown>; do<T>(name:string,run:()=>Promise<T>):Promise<T> }, wake:()=>Promise<{stop:boolean}>, deadline:number, now=Date.now) {
 for(let pass=0; now()<deadline+300000 && pass<750; pass++) {
  const result=await steps.do(`balanced-wake-${pass}`,wake);
  if(result.stop)return;
  await steps.sleep(`balanced-wait-${pass}`,10000);
 }
}
