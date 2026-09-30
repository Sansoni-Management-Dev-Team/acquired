import { and, eq } from "drizzle-orm";
import { outreachEmail } from "@/domain/outreach-contact";
import type { ResearchFinding } from "@/domain/research";
import { requireDb } from "./client";
import { contacts } from "./schema";

// Keep incomplete leads as research evidence. Only a published email creates a
// contact, and stronger enrichment and contact preferences always take priority.
export async function saveResearchContact(args: {
  database: ReturnType<typeof requireDb>;
  organizationId: string;
  targetId: string;
  evidence: ResearchFinding;
  sourceUrl: string;
  observedAt: Date;
}) {
  const email = outreachEmail(args.evidence.email);
  if (args.evidence.kind !== "person" || !email) return;
  const normalName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
  const existing = (await args.database.select().from(contacts).where(and(eq(contacts.organizationId, args.organizationId), eq(contacts.targetId, args.targetId))))
    .find(contact => normalName(contact.displayName) === normalName(args.evidence.name));
  if (existing) {
    const personal = existing.personalData as Record<string, unknown> | null;
    if (outreachEmail(personal?.email) || existing.firmablePersonId || existing.fictionalised) return;
    await args.database.update(contacts).set({ personalData: { ...personal, email, emailStatus: "published-unverified" } })
      .where(and(eq(contacts.id, existing.id), eq(contacts.organizationId, args.organizationId)));
    return;
  }
  await args.database.insert(contacts).values({
    organizationId: args.organizationId, targetId: args.targetId,
    displayName: args.evidence.name, role: args.evidence.value, fictionalised: false,
    personalData: { email, emailStatus: "published-unverified", doNotContact: false },
    provenance: { source: "Cloudflare public web research", sourceUrl: args.sourceUrl,
      quote: args.evidence.quote, capturedAt: args.observedAt.toISOString(), roleStatus: "published-unverified" },
  });
}
