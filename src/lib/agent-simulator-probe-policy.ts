/** Fixed local simulator origins only. The original five-lead write actions
 * never inherit a new profile or redirect their existing recipient/account. */
export function assertSimulatorProbeProfile(env:Record<string,string|undefined>,action:string){
 const origin=env.UNIPILE_API_URL;
 if(env.NODE_ENV==='production'||env.AGENT_MODE_COMMUNICATIONS_MODE!=='simulator'||!['https://127.0.0.1:5490','https://127.0.0.1:5590','https://127.0.0.1:5690'].includes(origin??'')||env.COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN!==origin||!['state','setup','default','sync','seed','transport-smoke'].includes(action)||['seed','transport-smoke'].includes(action)&&origin!=='https://127.0.0.1:5490')throw Error('Exact local simulator action/profile required');
 return origin!;
}

export function simulatorProbeOwnerScope(origin:string,ownerFile?:string){
 const profiles:Record<string,{path:string;organizationId:string}>={'https://127.0.0.1:5590':{path:'/workspace/.local-data/agent-mode-orbstack/pilot25-isolated-owner.private.json',organizationId:'8d583d4c-68ac-4f43-9e06-483b3cf5d026'},'https://127.0.0.1:5690':{path:'/workspace/.local-data/agent-mode-orbstack/pilot50-isolated-owner.private.json',organizationId:'8d583d4c-68ac-4f43-9e06-483b3cf5d050'}};
 if(!ownerFile&&origin!=='https://127.0.0.1:5690')return null;
 const profile=profiles[origin];if(!profile||ownerFile!==profile.path)throw Error('Exact isolated pilot owner file required');return profile;
}
