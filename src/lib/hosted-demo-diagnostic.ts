/** Fixed diagnostic boundaries only. No error message, payload, SQL or credentials. */
export function reportHostedDemoFailure(boundary:string,error?:unknown){
 try{
  if(process.env.AGENT_VERBOSE_LOGGING!=='true'||! /^(access\.(pool|setup|membership|run|registration|commit)|coverage\.(input|proof|connect|revalidate|sql\.(schema|gate|member|role|scope|binding|freshness|checkpoint_read|monitor_write|checkpoint_write|commit|setup))|bridge\.(local_binding|revalidate|project)|callback\.(access|coverage))$/.test(boundary))return;
  const code=error&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,'code')?.value:undefined;
  const sqlState=typeof code==='string'&&['40001','40P01','55P03','57014','42501','25006','55000'].includes(code)?code:undefined;
  console.warn('hosted-demo-failure',JSON.stringify({boundary,...(sqlState?{sqlState}:{})}));
 }catch{/* Diagnostics must not affect outcomes, retries or admission. */}
}

/** Fixed revalidation outcomes only; never accepts response bodies or credentials. */
export function reportHostedCoverageRevalidation(outcome:'http_error'|'verification_refused',httpStatus?:number){
 try{
  if(process.env.AGENT_VERBOSE_LOGGING!=='true')return;
  if(outcome==='http_error'){
   if(typeof httpStatus!=='number'||!Number.isInteger(httpStatus)||httpStatus<400||httpStatus>599)return;
   console.warn('hosted-demo-revalidation',JSON.stringify({boundary:'coverage.revalidate',outcome,httpStatus}));
  }else if(outcome==='verification_refused')console.warn('hosted-demo-revalidation',JSON.stringify({boundary:'coverage.revalidate',outcome}));
 }catch{/* Diagnostics cannot change admission or retries. */}
}
