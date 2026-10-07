import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { writeFileSync,mkdirSync } from 'node:fs';
import { readAccreditationContact,nataListingUrl } from '../src/adapters/accreditation-register';
import { saveAccreditationContact } from '../src/db/accreditation-contacts';
import * as schema from '../src/db/schema';
// Explicit bounded local capture. This command never migrates or unlocks provider phones.
const args=process.argv.slice(2),value=(flag:string)=>args[args.indexOf(flag)+1];
const targetId=value('--target'),source=value('--source'),url=process.env.FIRMABLE_INTEGRATION_DATABASE_URL;
if(!args.includes('--target')||!args.includes('--source')||!/^[0-9a-f-]{36}$/.test(targetId)||!nataListingUrl(source))throw Error('Explicit target UUID and public NATA listing URL required');
if(!url||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw Error('Explicit local PostgreSQL URL required');
const client=new Client({connectionString:url});await client.connect();
try{
 await client.query('BEGIN READ ONLY');await client.query("SET LOCAL statement_timeout='5s'");
 const {rows:[target]}=await client.query('SELECT organization_id,domain FROM targets WHERE id=$1',[targetId]);await client.query('ROLLBACK');
 if(!target?.domain)throw Error('Target with domain required');
 const contact=await readAccreditationContact(source,target.domain,Date.now()+30_000);
 if(!contact)throw Error('No source-linked named accreditation contact found; no write performed');
 if(!args.includes('--apply'))console.log(JSON.stringify({mode:'preview',matched:true,role:contact.role,sourceUrl:contact.sourceUrl,phonePresent:Boolean(contact.phone)}));
 else{
  await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='5s'");
  const {rows:[locked]}=await client.query('SELECT organization_id,domain FROM targets WHERE id=$1 FOR UPDATE',[targetId]);
  if(locked?.organization_id!==target.organization_id||locked?.domain!==target.domain)throw Error('Target changed; capture cancelled');
  const database=drizzle({client,schema});const contactId=await saveAccreditationContact(database,target.organization_id,targetId,contact);
  const {rows:[saved]}=await client.query('SELECT count(*)::int AS n FROM contacts WHERE id=$1 AND target_id=$2 AND organization_id=$3',[contactId,targetId,target.organization_id]);
  if(saved.n!==1)throw Error('Capture verification failed');await client.query('COMMIT');
  const audit={capturedAt:new Date().toISOString(),database:'local OrbStack',targetId,contactId,role:contact.role,sourceUrl:contact.sourceUrl,verifiedContacts:saved.n,phonePresent:true,paidLookup:false,migration:false};
  mkdirSync('.local-data',{recursive:true});writeFileSync(`.local-data/register-contact-capture-${targetId}.json`,JSON.stringify(audit,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(audit));
 }
}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{await client.end();}
