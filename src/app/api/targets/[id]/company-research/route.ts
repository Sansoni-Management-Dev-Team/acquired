import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { requireDb } from "@/db/client";
import { researchFindings, researchJobs } from "@/db/schema";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { ResearchRepository } from "@/db/research-repository";
import { researchEnabled, researchWorker } from "@/lib/research-service";
import { publicResearchUrl, researchUrlKey, uniqueResearchUrls, terminalResearchStates, type ResearchConfig } from "@/domain/research";
async function context(request: Request, id: string, mandateId: unknown) {
  const session = await auth.api.getSession({ headers: request.headers });
  const org = session?.session.activeOrganizationId;
  if (!org || !session) return { error: Response.json({ error: "Sign in first" }, { status: 401 }) };
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(mandateId).success) return { error: Response.json({ error: "Invalid company or mandate" }, { status: 400 }) };
  const repo = new AcquisitionRepository(org);
  if (!await repo.getMandate(mandateId as string)) return { error: Response.json({ error: "Mandate not found" }, { status: 404 }) };
  const member = (await repo.memberships(mandateId as string)).find(m => m.target.id === id);
  if (!member) return { error: Response.json({ error: "Company not found" }, { status: 404 }) };
  return { org, session, member, mandateId: mandateId as string };
}
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await context(request, id, new URL(request.url).searchParams.get("mandateId"));
  if (c.error) return c.error;
  const db = requireDb();
  const [jobs, findings] = await Promise.all([
    db.select().from(researchJobs).where(and(eq(researchJobs.organizationId, c.org), eq(researchJobs.mandateId, c.mandateId), sql`${researchJobs.config}->>'purpose' = 'firmographics'`, sql`${researchJobs.config}->>'targetId' = ${id}`)).orderBy(desc(researchJobs.createdAt)).limit(20),
    db.select().from(researchFindings).where(and(eq(researchFindings.organizationId, c.org), eq(researchFindings.mandateId, c.mandateId), eq(researchFindings.targetId, id))),
  ]);
  for (const job of jobs.filter(j => !terminalResearchStates.includes(j.status) && Date.now() - j.updatedAt.getTime() > 90000)) {
    try {
      const worker = await researchWorker(`/jobs/${job.id}`) as { status: string };
      if (["errored", "terminated", "complete"].includes(worker.status)) {
        await new ResearchRepository(c.org).recoverStopped(job.id, job.revision, job.pages);
        const current = await new ResearchRepository(c.org).get(job.id);
        if (current) Object.assign(job, current);
      }
    } catch { /* Preserve running state when the status check is unavailable. */ }
  }
  return Response.json({ enabled: researchEnabled(), webSearchEnabled: researchEnabled(), jobs: jobs.filter(j => (j.config as ResearchConfig).purpose === "firmographics" && (j.config as ResearchConfig).targetId === id), findings: findings.filter(f => ["headcount", "revenue", "company_relationship", "company_contact", "founded_year", "location", "industry"].includes((f.evidence as { kind: string }).kind)) }, { headers: { "Cache-Control": "no-store" } });
}
const inputSchema = z.object({ action: z.literal("start"), mandateId: z.string().uuid(), requestId: z.string().uuid(), continueFrom: z.string().uuid().optional(), approved: z.literal(true) });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const c = await context(request, id, input.data.mandateId);
  if (c.error) return c.error;
  if (!researchEnabled()) return Response.json({ error: "Cloudflare research is not configured" }, { status: 503 });
  const domain = c.member.target.domain;
  const seed = domain && publicResearchUrl(`https://${domain}/`);
  if (!seed) return Response.json({ error: "Add and review the company website in its worksheet first" }, { status: 409 });
  let config: ResearchConfig = { purpose: "firmographics", targetedFollowup: true, targetId: id, companyName: c.member.target.companyName, companyDomain: new URL(seed).hostname.replace(/^www\./, ""), seeds: [seed], searchTerms: ["company size industry founded headquarters"], geography: "Australia", discover: true, approved: true, strategy: "investigate", budget: { maxPages: 5, maxDomains: 3, maxModelCalls: 5, maxMinutes: 10 } };
  const repo = new ResearchRepository(c.org);
  if (input.data.continueFrom) {
    const previous = await repo.get(input.data.continueFrom);
    const saved = previous?.config as ResearchConfig | undefined;
    if (!previous || previous.mandateId !== c.mandateId || saved?.purpose !== "firmographics" || saved.targetId !== id || saved.companyDomain !== config.companyDomain || !terminalResearchStates.includes(previous.status)) return Response.json({ error: "No completed company research to continue for this company" }, { status: 409 });
    const retry = (saved.runtime?.attempts || []).filter(a => a.status !== "read").map(a => a.url);
    const remaining = uniqueResearchUrls([...retry, ...(saved.runtime?.remaining || [])]);
    if (!remaining.length) return Response.json({ error: "No unread pages remain. Start a fresh search instead." }, { status: 409 });
    config = { ...saved, approved: true, parentJobId: previous.id, discover: false, budget: config.budget, seeds: remaining.slice(0, 10), runtime: { remaining, visited: (saved.runtime?.visited || []).filter(url => !retry.some(r => researchUrlKey(r) === researchUrlKey(url))), attempts: [] } };
  }
  const prior = await repo.get(input.data.requestId);
  if (prior && (prior.mandateId !== c.mandateId || (prior.config as ResearchConfig).targetId !== id || (prior.config as ResearchConfig).purpose !== "firmographics")) return Response.json({ error: "Request ID belongs to another job" }, { status: 409 });
  try {
    const job = await repo.create(input.data.requestId, c.mandateId, c.session.user.id, config);
    if (!terminalResearchStates.includes(job.status)) await researchWorker(`/jobs/${job.id}`, "POST");
    return Response.json({ jobId: job.id }, { status: 202 });
  } catch {
    const saved = await repo.get(input.data.requestId);
    if (saved) return Response.json({ jobId: saved.id, message: "Job saved; use Reconnect to retry dispatch without starting another job" }, { status: 202 });
    return Response.json({ error: "Another research job is active for this organisation. Wait for it or cancel it first." }, { status: 409 });
  }
}
