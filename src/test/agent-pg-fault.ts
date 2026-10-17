import type {Pool} from 'pg';
/** Test-only fault injection after earlier writes on the SAME real transaction.
 * No ALTER TABLE, temporary constraints or additional schema permissions. */
export function agentOutboxFailurePool(pool:Pool):Pool{
 return new Proxy(pool,{get(target,key,receiver){
  if(key!=='connect')return Reflect.get(target,key,receiver);
  return async()=>{
   const client=await target.connect();
   return new Proxy(client,{get(current,property){
    if(property==='query')return (text:unknown,...args:unknown[])=>{
     if(typeof text==='string'&&/INSERT INTO agent_events\b/.test(text))return Promise.reject(new Error('Injected agent outbox failure'));
     return Reflect.apply(current.query,current,[text,...args]);
    };
    const value=Reflect.get(current,property);return typeof value==='function'?value.bind(current):value;
   }});
  };
 }});
}
