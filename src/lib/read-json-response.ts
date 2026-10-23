/** Decode the object envelope used by application APIs. Empty, truncated or
 * intermediary HTML responses are unconfirmed outcomes, including HTTP200.
 * Callers retain their status handling, domain validation and exact retry key. */
export async function readJsonResponse<T = Awaited<ReturnType<Response['json']>>>(response:Response,unconfirmed:string):Promise<T>{
 let value:unknown;
 try{value=await response.json();}catch{throw new Error(unconfirmed);}
 if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error(unconfirmed);
 return value as T;
}
