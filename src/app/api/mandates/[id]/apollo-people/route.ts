import { createHash } from "node:crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { requireDb } from "@/db/client";
import { mandateTargets, targets, researchJobs, researchFindings } from "@/db/schema";
import { findApolloPeople } from "@/adapters/apollo-people";
import { acquireTargetSearch, TargetSearchRateLimitError } from "@/adapters/target-search-guard";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  const org = session?.session.activeOrganizationId;
  if (!org || !session) return Response.json({ error: "Sign in and select an organisation." }, { status: 401 });
  const input = z.object({ targetId: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  const { id } = await params;
  if (!input.success || !z.string().uuid().safeParse(id).success) return Response.json({ error: "Invalid company or mandate." }, { status: 400 });
  const db = requireDb();
  const [member] = await db.select({ target: targets }).from(mandateTargets).innerJoin(targets, and(eq(targets.id, mandateTargets.targetId), eq(targets.organizationId, mandateTargets.organizationId))).where(and(eq(mandateTargets.organizationId, org), eq(mandateTargets.mandateId, id), eq(mandateTargets.targetId, input.data.targetId)));
  if (!member) return Response.json({ error: "Company not found in this mandate." }, { status: 404 });
  if (!process.env.APOLLO_API_KEY) return Response.json({ error: "APOLLO_API_KEY is not configured on the server." }, { status: 503 });
  if (!member.target.domain) return Response.json({ error: "Add the company website before searching Apollo." }, { status: 400 });
  let release: (() => void) | undefined;
  try {
    release = acquireTargetSearch(`${org}:apollo`, { cooldownMs: 0 });
    const result = await findApolloPeople(member.target.domain);
    const now = new Date();
    const hash = createHash("sha256").update(`${org}:${id}:${member.target.id}:apollo`).digest("hex");
    const jobId = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
    await db.transaction(async tx => {
      await tx.insert(researchJobs).values({ id: jobId, organizationId: org, mandateId: id, createdBy: session.user.id, status: "complete", config: { purpose: "people", provider: "apollo", targetId: member.target.id, companyDomain: member.target.domain }, message: `Apollo: ${result.people.length} matched people; ${result.failed} lookups failed.` }).onConflictDoUpdate({ target: researchJobs.id, set: { updatedAt: now, message: `Apollo: ${result.people.length} matched people; ${result.failed} lookups failed.` } });
      for (const p of result.people) {
        const evidence = { kind: "person", name: p.name, value: p.role, website: p.sourceUrl, quote: `Apollo lists ${p.name} as ${p.role} at ${member.target.companyName} (${member.target.domain}).`, relevance: "unclear", source: "Apollo", status: "unverified", saleAuthority: "unconfirmed" };
        await tx.insert(researchFindings).values({ jobId, organizationId: org, mandateId: id, targetId: member.target.id, evidenceKey: `apollo:${p.id}`, sourceUrl: p.sourceUrl, observedAt: now, confidence: 0.4, evidence }).onConflictDoUpdate({ target: [researchFindings.jobId, researchFindings.evidenceKey], set: { evidence, observedAt: now } });
      }
    });
    return Response.json({ saved: result.people.length, message: result.people.length ? `${result.people.length} Apollo people saved for review.` : "No fully named people matched the company's current domain.", warnings: result.failed ? [`${result.failed} enrichment lookups failed. Check Apollo access or credits.`] : [] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Apollo lookup failed." }, { status: error instanceof TargetSearchRateLimitError ? 429 : 502 });
  } finally { release?.(); }
}
