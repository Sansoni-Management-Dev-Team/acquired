import type { AccreditationContact } from '@/adapters/accreditation-register';
import type { requireDb } from './client';
import { contacts } from './schema';
import { researchContactId } from './research-persistence-id';
/** Published register contacts retain their administrative role; no seniority is inferred. */
export async function saveAccreditationContact(database: ReturnType<typeof requireDb>, organizationId: string, targetId: string, contact: AccreditationContact) {
  const id = researchContactId(organizationId,targetId,`${contact.registry}:${contact.siteNumber}:${contact.name}`);
  const personalData = {phone:contact.phone,phoneSaved:true,phoneAvailable:true,phonePotentiallyAvailable:true,phoneLookupStatus:'reported',emailLookupStatus:'not_requested',doNotContact:false,contactType:'accreditation'};
  const provenance = {source:'Public accreditation register',sourceUrl:contact.sourceUrl,capturedAt:contact.capturedAt,registry:contact.registry,accreditationNumber:contact.accreditationNumber,siteNumber:contact.siteNumber,roleStatus:'published-register-contact'};
  // Do not overwrite an existing contact's preferences or manually reviewed data.
  await database.insert(contacts).values({id,organizationId,targetId,displayName:contact.name,role:contact.role,fictionalised:false,personalData,provenance}).onConflictDoNothing({target:contacts.id});
  return id;
}
