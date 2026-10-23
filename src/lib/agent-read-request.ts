import {readJsonResponse} from './read-json-response';
/** Bundled saved-state reads replace multiple gated transactions. Keep a finite
 * response budget and caller cancellation; never replay an action here. */
export async function readAgentStatus(url:string,signal:AbortSignal){
 signal.throwIfAborted();
 const response=await fetch(url,{cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
 if(!response.ok)throw new Error('Saved activity unavailable');
 return readJsonResponse(response,'Could not confirm the response. Check saved progress before retrying.');
}
