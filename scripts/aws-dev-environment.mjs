import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function appEnvironment(secret,{researchEnabled='false',researchUrl=''}={}){
  if(!['true','false'].includes(researchEnabled))throw Error('RESEARCH_ENABLED must be explicit');
  for(const key of ['ACQUIRE_DATABASE_USERNAME','ACQUIRE_DATABASE_PASSWORD','ACQUIRE_DATABASE_HOST','ACQUIRE_BETTER_AUTH_SECRET'])if(typeof secret[key]!=='string'||!secret[key])throw Error(`Missing ${key}`);
  const db=new URL('postgresql://placeholder');
  db.username=secret.ACQUIRE_DATABASE_USERNAME;db.password=secret.ACQUIRE_DATABASE_PASSWORD;
  if(!/^[a-z0-9.-]+$/.test(secret.ACQUIRE_DATABASE_HOST))throw Error('Invalid database host');
  db.hostname=secret.ACQUIRE_DATABASE_HOST;db.port='5432';db.pathname='/acquire';
  if(researchEnabled==='true'){
    if(!/^http:\/\/[a-z0-9.-]+\.internal:8787$/.test(researchUrl))throw Error('Research requires a private UAT service endpoint');
    if(typeof secret.RESEARCH_SERVICE_SECRET!=='string'||secret.RESEARCH_SERVICE_SECRET.length<32)throw Error('Missing UAT research service secret');
  }
  const values={DATABASE_DRIVER:'postgres',DATABASE_URL:db.href,BETTER_AUTH_SECRET:secret.ACQUIRE_BETTER_AUTH_SECRET,APP_URL:'https://app.acquire.pajamaprofits.net',NEXT_PUBLIC_APP_URL:'https://app.acquire.pajamaprofits.net',TARGET_DATA_PROVIDER:'fixture',OUTREACH_DRAFTING_PROVIDER:'fixture',RESEARCH_ENABLED:researchEnabled};
  for(const key of ['OPENROUTER_API_KEY','OPENAI_API_KEY','RESEND_API_KEY','AUTH_EMAIL_FROM','APP_READINESS_SECRET','RESEARCH_SERVICE_SECRET','FIRMABLE_TRANSPORT','FIRMABLE_SERVICE_URL','FIRMABLE_SERVICE_SECRET','FIRMABLE_API_KEY'])if(secret[key])values[key]=secret[key];
  if(researchEnabled==='true')values.RESEARCH_WORKER_URL=researchUrl;
  return Object.entries(values).map(([key,value])=>{
    if(typeof value!=='string'||/[\r\n\0]/.test(value))throw Error(`Invalid environment value for ${key}`);
    return `${key}=${value}`;
  }).join('\n')+'\n';
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [input,output]=process.argv.slice(2);
  if(!input||!output)throw Error('Provide the private secret JSON and output paths');
  let secret;
  try{secret=JSON.parse(readFileSync(input,'utf8'));}catch{throw Error('App secret must contain valid JSON');}
  writeFileSync(output,appEnvironment(secret,{researchEnabled:process.env.ACQUIRE_RESEARCH_ENABLED||'false',researchUrl:process.env.ACQUIRE_RESEARCH_WORKER_URL||''}),{mode:0o600});
}
