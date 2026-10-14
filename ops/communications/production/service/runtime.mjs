import {pathToFileURL} from 'node:url';
/** Decode hosted CA transport without logging values or silently preferring ambiguous inputs. */
export function prepareServiceEnvironment(input){
 const result={...input},encoded=result.DATABASE_SSL_CA_BASE64;
 if(encoded){
  if(result.DATABASE_SSL_CA||typeof encoded!=='string'||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))throw Error('Hosted database CA unavailable');
  try{
   const bytes=Buffer.from(encoded,'base64');if(bytes.toString('base64')!==encoded)throw Error();
   const ca=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
   if(!ca.startsWith('-----BEGIN CERTIFICATE-----')||!ca.trimEnd().endsWith('-----END CERTIFICATE-----')||ca.includes('\0'))throw Error();
   result.DATABASE_SSL_CA=ca;
  }catch{throw Error('Hosted database CA unavailable');}
 }
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  Object.assign(process.env,prepareServiceEnvironment(process.env));
  await import(process.argv.includes('--check-config')?'./configuration-preflight.cjs':'./service.cjs');
 }catch{process.stderr.write('Communications production startup unavailable; inspect private configuration.\n');process.exitCode=1;}
}
