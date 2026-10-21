import {assertManagementSetupResponse,localSimulatorHostedOrigin} from '../../communications/packages/contracts/src/management';
/** Only the public mock origin crosses into browser props. */
export function configuredLocalSetupOrigin(env:Readonly<Record<string,string|undefined>>):string|undefined {
 const origin=env.COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN;if(origin===undefined)return undefined;
 if(env.NODE_ENV==='production'||env.AGENT_MODE_COMMUNICATIONS_MODE!=='simulator')throw Error('Explicit local simulator profile required');
 return localSimulatorHostedOrigin(origin);
}
export function hostedSetupRedirect(value:unknown,options?:{localSimulatorOrigin?:string;pageOrigin?:string}):string {
 if(options?.localSimulatorOrigin!==undefined){
  const page=options.pageOrigin??'';
  if(!['http://acquire-agent.orb.local','http://localhost:3026'].includes(page))localSimulatorHostedOrigin(page);
 }
 assertManagementSetupResponse(value,options);
 if(value.status!=='redirect')throw Error('Invalid link');return new URL(value.action.url).href;
}
