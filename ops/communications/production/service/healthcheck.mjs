import {pathToFileURL} from 'node:url';
/** Liveness and contract check only: startup separately preflights approved storage. */
export async function checkServiceHealth(request=fetch){
 const response=await request('http://127.0.0.1:5461/health',{signal:AbortSignal.timeout(3000)});
 if(!response.ok)throw Error('Communications health unavailable');
 const body=await response.json();
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||body.contractVersion!=='1')throw Error('Communications contract unavailable');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await checkServiceHealth();}catch{process.exitCode=1;}
}
