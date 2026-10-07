import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import { Client } from 'pg';
import { drizzle,type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
vi.mock('./client',()=>({requireDb:vi.fn()}));
import { saveAccreditationContact } from './accreditation-contacts';
import { parseAccreditationContact } from '@/adapters/accreditation-register';
import { contactCompleteness } from '@/domain/contact-completeness';
import * as schema from './schema';
describe.skipIf(process.env.RUN_FIRMABLE_DB_INTEGRATION!=='true')('Published accreditation contact PostgreSQL persistence',()=>{
 let client:Client,database:NodePgDatabase<typeof schema>,organizationId:string,targetId:string;
 beforeAll(async()=>{
  const url=process.env.FIRMABLE_INTEGRATION_DATABASE_URL;if(!url || !['127.0.0.1','localhost'].includes(new URL(url).hostname))throw Error('Explicit local PostgreSQL URL required');
  client=new Client({connectionString:url});await client.connect();await client.query('BEGIN');database=drizzle({client,schema});
  organizationId=`register-contact-${crypto.randomUUID()}`;await database.insert(schema.organization).values({id:organizationId,name:'Synthetic register proof',slug:organizationId});
  const [target]=await database.insert(schema.targets).values({organizationId,companyName:'Synthetic Laboratory',domain:'synthetic.example.test',firmographics:{}}).returning({id:schema.targets.id});targetId=target.id;
 });
 afterAll(async()=>{if(!client)return;try{await client.query('ROLLBACK');expect((await client.query('SELECT count(*)::int AS n FROM organization WHERE id=$1',[organizationId])).rows[0].n).toBe(0);}finally{await client.end();}});
 it('parser → durable contact keeps named phone, accreditation role and source; replay preserves contact preference',async()=>{
  const contact=parseAccreditationContact('<p>Accreditation No. 12345 Site No. 67890</p><a href="https://synthetic.example.test/">Website</a><p>Contact Ms Avery Morgan P: +61 0400 000 999</p>','https://nata.com.au/accredited-organisation/synthetic-12345-67890/','synthetic.example.test')!;
  const id=await saveAccreditationContact(database,organizationId,targetId,contact);
  let [row]=await database.select().from(schema.contacts).where(eq(schema.contacts.id,id));
  expect(row).toMatchObject({displayName:'Avery Morgan',role:'Accreditation contact',fictionalised:false,firmablePersonId:null});
  expect(row.provenance).toMatchObject({sourceUrl:contact.sourceUrl,registry:'NATA',accreditationNumber:'12345',siteNumber:'67890'});
  expect(contactCompleteness(row.personalData as Record<string,unknown>).phone).toMatchObject({saved:true,status:'reported'});
  await database.update(schema.contacts).set({personalData:{...(row.personalData as Record<string,unknown>),doNotContact:true}}).where(eq(schema.contacts.id,id));
  await saveAccreditationContact(database,organizationId,targetId,contact);
  [row]=await database.select().from(schema.contacts).where(eq(schema.contacts.id,id));expect(row.personalData).toMatchObject({doNotContact:true});
  expect(await database.select().from(schema.contacts).where(eq(schema.contacts.targetId,targetId))).toHaveLength(1);
 });
});
