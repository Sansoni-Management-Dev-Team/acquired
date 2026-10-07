import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { PersonCandidate, PersonDetail } from "@/adapters/source-contracts";
import { requireDb } from "./client";
import { contacts } from "./schema";
import { COMPANY_DATA_SOURCE } from "@/domain/provider-display";

type Database = ReturnType<typeof requireDb>;

export function firmableContactValues(person: PersonDetail, candidate: PersonCandidate | undefined, companyId: string) {
  return {
    displayName: person.name || "Decision-maker",
    role: person.position || candidate?.position,
    personalData: {
      firmablePersonId: person.id,
      email: person.email,
      phone: person.phone,
      linkedinUrl: person.linkedinUrl,
      seniority: person.seniority || candidate?.seniority,
      department: person.department || candidate?.department,
      emailAvailable: person.emailAvailable || candidate?.emailAvailable || false,
      phoneAvailable: person.phoneAvailable || candidate?.phoneAvailable || false,
      emailPotentiallyAvailable: person.emailAvailable || candidate?.emailAvailable || false,
      phonePotentiallyAvailable: person.phoneAvailable || candidate?.phoneAvailable || false,
      emailSaved: Boolean(person.email?.trim()),
      phoneSaved: Boolean(person.phone?.trim()),
      emailLookupStatus: person.email ? "reported" : person.emailLookupStatus || "not_reported",
      phoneLookupStatus: person.phone ? "reported" : person.phoneLookupStatus || "not_reported",
      doNotContact: person.doNotContact,
    },
    provenance: { source: COMPANY_DATA_SOURCE, capturedAt: new Date().toISOString(), companyId },
    fictionalised: person.fictionalised,
  };
}

export async function upsertFirmableContact(args: {
  database: Database;
  organizationId: string;
  targetId: string;
  companyId: string;
  person: PersonDetail;
  candidate?: PersonCandidate;
  existingContactId?: string | null;
}) {
  const [existing] = args.existingContactId === undefined
    ? await args.database.select({ id: contacts.id, personalData: contacts.personalData }).from(contacts).where(and(eq(contacts.organizationId, args.organizationId), eq(contacts.targetId, args.targetId), eq(contacts.firmablePersonId, args.person.id))).limit(1)
    : args.existingContactId
      ? await args.database.select({ id: contacts.id, personalData: contacts.personalData }).from(contacts).where(and(eq(contacts.id, args.existingContactId), eq(contacts.organizationId, args.organizationId))).limit(1)
      : [];
  const existingContactId = existing?.id;
  const values = firmableContactValues(args.person, args.candidate, args.companyId);
  if (args.person.phone === undefined && typeof (existing?.personalData as { phone?: unknown } | undefined)?.phone === 'string') {
    values.personalData.phone = (existing!.personalData as { phone: string }).phone;
    values.personalData.phoneAvailable = true;
    values.personalData.phoneSaved = true;
    values.personalData.phonePotentiallyAvailable = true;
    values.personalData.phoneLookupStatus = "reported";
  }
  if ((existing?.personalData as Record<string, unknown> | undefined)?.doNotContact === true) values.personalData.doNotContact = true;
  const [saved] = existingContactId
    ? await args.database.update(contacts).set({ ...values, firmablePersonId: args.person.id }).where(and(eq(contacts.id, existingContactId), eq(contacts.organizationId, args.organizationId))).returning({ id: contacts.id })
    : await args.database.insert(contacts).values({ organizationId: args.organizationId, targetId: args.targetId, firmablePersonId: args.person.id, ...values }).onConflictDoUpdate({
      target: [contacts.organizationId, contacts.targetId, contacts.firmablePersonId],
      targetWhere: isNotNull(contacts.firmablePersonId),
      set: { ...values, personalData: sql`jsonb_set(${JSON.stringify(values.personalData)}::jsonb, '{doNotContact}', to_jsonb(coalesce((${contacts.personalData}->>'doNotContact')::boolean, false) OR ${values.personalData.doNotContact}))` },
    }).returning({ id: contacts.id });
  return saved;
}
