export type FirmableLocalOutageEnv={LOCAL_DEVELOPMENT?:string;LOCAL_FIRMABLE_MODE?:string};
/** Explicit development outage switch, evaluated before credentials or transport.
 * An unknown/misplaced switch refuses work instead of restoring live access. */
export function firmableOutageResponse(env:FirmableLocalOutageEnv,path:string):{status:number;body:Record<string,unknown>;retryAfter?:number}|null{
 if(!env.LOCAL_FIRMABLE_MODE)return null;
 const paused=env.LOCAL_FIRMABLE_MODE==='disabled'&&env.LOCAL_DEVELOPMENT==='true';
 return{status:paused&&path==='/status'?200:503,body:{configured:false,providerOffline:true,category:paused?'provider_offline':'invalid_local_provider_configuration'}};
}
