import { and, eq, inArray } from "drizzle-orm";
import type { MembershipView } from "@/domain/acquisition";
import { requireDb } from "./client";
import { FirmableHistoryRepository, type StoredFirmablePerson } from "./firmable-history-repository";
import { contacts } from "./schema";

type Database = ReturnType<typeof requireDb>;
export type WorkspaceContactSummary = { targetId: string; name: string; role: string | null; reachable: boolean };
export type StoredFirmableContactData = { name: string; role: string | null; email?: string; phone?: string; linkedinUrl?: string; doNotContact: boolean };

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function firstValue(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  for (const entry of value) {
    if (typeof entry === "string" && entry) return entry;
    const record = object(entry);
    if (typeof record?.value === "string" && record.value) return record.value;
  }
  return undefined;
}

export function storedFirmableContactData(person: StoredFirmablePerson): StoredFirmableContactData {
  const profile = person.profile || {};
  const search = person.searchRecord;
  const emails = object(profile.emails);
  const phones = Array.isArray(profile.phones) ? profile.phones.map(object).filter(Boolean) as Record<string, unknown>[] : [];
  const email = typeof profile.work_email === "string" ? profile.work_email : firstValue(emails?.work);
  const phone = typeof profile.phone === "string" ? profile.phone : phones.map(item => item.value).find(value => typeof value === "string") as string | undefined;
  const linkedinUrl = [profile.linkedin, profile.linkedin_url].find(value => typeof value === "string" && value.trim()) as string | undefined;
  const name = [profile.name, profile.full_name, search.name, search.pName].find(value => typeof value === "string" && value.trim()) as string | undefined;
  const role = [profile.position, search.position, profile.headline].find(value => typeof value === "string" && value.trim()) as string | undefined;
  return { name: name || "Decision-maker candidate", role: role || null, email, phone, linkedinUrl, doNotContact: phones.some(item => item.is_dnd === true) || profile.is_dnd === true };
}

export function storedFirmableContactSummary(person: StoredFirmablePerson, targetId: string): WorkspaceContactSummary {
  const data = storedFirmableContactData(person);
  return { targetId, name: data.name, role: data.role, reachable: Boolean(data.email) && !data.doNotContact };
}

export async function loadWorkspaceContacts(database: Database, organizationId: string, memberships: MembershipView[]): Promise<WorkspaceContactSummary[]> {
  const targetIds = memberships.map(membership => membership.target.id);
  if (!targetIds.length) return [];
  const existing = await database.select().from(contacts).where(and(eq(contacts.organizationId, organizationId), inArray(contacts.targetId, targetIds)));
  const resultByKey = new Map<string, WorkspaceContactSummary>();
  for (const contact of existing) {
    const personal = contact.personalData as Record<string, unknown>;
    const legacy = personal.firmablePersonId;
    const personId = contact.firmablePersonId || (typeof legacy === "string" ? legacy : undefined);
    resultByKey.set(personId ? `${contact.targetId}:${personId}` : `contact:${contact.id}`, { targetId: contact.targetId, name: contact.displayName, role: contact.role, reachable: !contact.fictionalised && Boolean(personal.email) && personal.doNotContact !== true });
  }
  const savedPeople = new Map<string, typeof existing[number]>(existing.flatMap(contact => {
    const legacy = (contact.personalData as Record<string, unknown>).firmablePersonId;
    const id = contact.firmablePersonId || (typeof legacy === "string" ? legacy : undefined);
    return id ? [[`${contact.targetId}:${id}`, contact] as const] : [];
  }));
  const companyIds = [...new Set(memberships.flatMap(membership => membership.target.sourceData?.firmable?.firmableId ? [membership.target.sourceData.firmable.firmableId] : []))];
  const shared = await new FirmableHistoryRepository(database).latestPeople(companyIds);
  for (const membership of memberships) {
    const companyId = membership.target.sourceData?.firmable?.firmableId;
    if (!companyId) continue;
    for (const person of shared.get(companyId) || []) {
      const key = `${membership.target.id}:${person.personId}`;
      const local = savedPeople.get(key);
      const localCaptured = local ? Date.parse(String((local.provenance as Record<string, unknown>).capturedAt || "")) : 0;
      if (local && (!person.fetchedAt || person.fetchedAt.getTime() <= localCaptured)) continue;
      const projected = storedFirmableContactSummary(person, membership.target.id);
      if (local && (local.personalData as Record<string, unknown>).doNotContact === true) projected.reachable = false;
      resultByKey.set(key, projected);
    }
  }
  return [...resultByKey.values()];
}
