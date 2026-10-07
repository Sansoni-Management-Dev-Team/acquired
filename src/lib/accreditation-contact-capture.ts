import { accreditationSourceUrls, readAccreditationContact } from '@/adapters/accreditation-register';
import { saveAccreditationContact } from '@/db/accreditation-contacts';
import type { requireDb } from '@/db/client';
export async function captureAccreditationContacts(database: ReturnType<typeof requireDb>, input: {organizationId:string;targetId:string;domain:string;raw:Record<string,unknown>;deadline?:number}) {
  let saved = 0, failed = 0;
  for (const source of accreditationSourceUrls(input.raw)) {
    try { const contact = await readAccreditationContact(source,input.domain,input.deadline); if (contact) {await saveAccreditationContact(database,input.organizationId,input.targetId,contact);saved++;} }
    catch { failed++; }
  }
  return {saved,failed};
}
