import {types} from 'node:util';
/** Dotenv data only: never execute/source the result as a shell script.
 * Single quotes preserve JSON, backslashes and literal dollars under both
 * Node parseEnv and Compose. Values containing an apostrophe use double
 * quotes only if no escaping or Compose expansion could be required.
 */
export function serializeAgentEnvironment(values){
 try{
  if(!values||types.isProxy(values)||![Object.prototype,null].includes(Object.getPrototypeOf(values)))throw Error();
  const descriptors=Object.getOwnPropertyDescriptors(values),lines=[];
  for(const key of Reflect.ownKeys(descriptors)){
   if(typeof key!=='string'||! /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||!('value' in descriptors[key]))throw Error();
   const value=descriptors[key].value;
   if(typeof value!=='string'||/[\r\n\0]/.test(value))throw Error();
   if(!value.includes("'"))lines.push(`${key}='${value}'`);
   else{if(/["\\$]/.test(value))throw Error();lines.push(`${key}="${value}"`);}
  }
  return lines.length?lines.join('\n')+'\n':'';
 }catch{throw new Error('Invalid local agent environment values');}
}
