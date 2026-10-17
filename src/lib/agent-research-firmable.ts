import {FirmableClient} from '@/adapters/firmable-client';
import {createNativeResearchProviderFetch} from './agent-research-provider-fetch';
/** Native-only composition. Original UI keeps its existing client and scheduling.
 * Each Firmable transport HTTP call reserves budget before the client sees it.
 * Automatic client retries are disabled; retries need explicit saved step keys.
 * Unknown provider cost retains the conservative reviewed reservation. */
export function createNativeResearchFirmableClient(options:Omit<Parameters<typeof createNativeResearchProviderFetch>[0],'provider'|'fetch'>&{fetch?:typeof fetch}){
 return new FirmableClient({retries:0,fetch:createNativeResearchProviderFetch({...options,provider:'firmable',fetch:options.fetch??fetch})});
}

/** End-to-end native production path: accounting happens inside the existing
 * shared account coordinator immediately around each real upstream HTTP call.
 * This outer service request must not be charged again as a provider request. */
export function createNativeFirmableTransport(options:{jobId:string;stepKey:string;targetId?:string;fetch?:typeof fetch}){
 if(process.env.FIRMABLE_TRANSPORT!=='cloudflare-session')throw new Error('Native Firmable research requires the metered account transport');
 const physical=options.fetch??fetch;
 return new FirmableClient({retries:0,fetch:async(input,init)=>{
  const headers=new Headers(init?.headers);headers.set('x-acquire-native-research-job',options.jobId);headers.set('x-acquire-native-research-key',options.stepKey);if(options.targetId)headers.set('x-acquire-native-research-target',options.targetId);
  return physical(input,{...init,headers});
 }});
}
