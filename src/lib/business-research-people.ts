import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { requireDb } from "@/db/client";
import { researchJobs, researchFindings } from "@/db/schema";
import { ResearchRepository } from "@/db/research-repository";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { eligibleForPeople } from "@/domain/business-research";
import { researchDomain, terminalResearchStates, type ResearchConfig, type ResearchFinding } from "@/domain/research";
import { researchWorker } from "./research-service";
export async function dispatchBusinessPeople(org: string, completedId: string) {
  const db = requireDb(), repo = new ResearchRepository(org);
  const completed = await repo.get(completedId);
  if (!completed) return;
  const completedConfig = completed.config as ResearchConfig;
  const parent = completedConfig.purpose === "people" && completedConfig.parentJobId ? await repo.get(completedConfig.parentJobId) : completed;
  if (!parent || !terminalResearchStates.includes(parent.status) || parent.status === "cancelled") return;
  const config = parent.config as ResearchConfig;
  if (config.workflow !== "business" || !config.findPeople || !config.peopleBudget) return;
  const children = await db.select().from(researchJobs).where(and(eq(researchJobs.organizationId, org), sql`${researchJobs.config}->>'parentJobId' = ${parent.id}`, sql`${researchJobs.config}->>'purpose' = 'people'`));
  if (children.some(j => j.status === "cancelled")) return;
  const active = children.find(j => !terminalResearchStates.includes(j.status));
  if (active) { if (active.status === "queued") await researchWorker(`/jobs/${active.id}`, "POST"); return; }
  if (children.length >= config.peopleBudget.maxCompanies) return;
  const findings = await db.select().from(researchFindings).where(and(eq(researchFindings.organizationId, org), eq(researchFindings.jobId, parent.id)));
  const members = await new AcquisitionRepository(org).memberships(parent.mandateId);
  const next = members.find(member => {
    if (!member.target.domain || ["parked", "excluded"].includes(member.assessment.stage) || children.some(j => (j.config as ResearchConfig).targetId === member.target.id)) return false;
    const evidence = findings.filter(f => f.targetId === member.target.id && researchDomain(f.sourceUrl) === member.target.domain).map(f => f.evidence as ResearchFinding);
    return eligibleForPeople(member.target.domain, member.assessment.stage, evidence);
  });
  if (!next) return;
  // Stable IDs make callback retries and racing terminal events idempotent.
  const hash = createHash("sha256").update(`${parent.id}:${next.target.id}:people`).digest("hex");
  const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
  const pages = config.peopleBudget.maxPages;
  const child: ResearchConfig = { purpose: "people", parentJobId: parent.id, targetId: next.target.id, companyName: next.target.companyName, companyDomain: next.target.domain!, seeds: config.peopleLinks?.[next.target.id]?.slice(0, 9).concat(`https://${next.target.domain}/`) || [`https://${next.target.domain}/`], searchTerms: ["owner founder director management team"], geography: config.geography, discover: true, approved: true, maxPeopleSearches: 1, strategy: "investigate", budget: { maxPages: pages, maxDomains: Math.min(3, pages), maxModelCalls: pages, maxMinutes: 5 } };
  const job = await repo.create(id, parent.mandateId, parent.createdBy, child);
  if (!terminalResearchStates.includes(job.status)) await researchWorker(`/jobs/${job.id}`, "POST");
}
