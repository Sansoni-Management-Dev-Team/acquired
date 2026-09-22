import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireDb } from "./client";
import { coverageRuns, mandates, mandateTargets, targets, valuationObservations, organization, researchFindings } from "./schema";
import { OrganizationRepository } from "./repositories";
import { assessmentSchema, briefSchema, briefToMandate, emptyBrief, initialAssessment, type AcquisitionBrief, type Accreditation, type Assessment, type CoverageRun, type CoverageSource, type MandateView, type MembershipView, type ValuationObservation } from "@/domain/acquisition";
import { assessMembership } from "@/domain/mandate-assessment";
import { buyerProfileFromMetadata } from "@/domain/buyer-profile";

export class AcquisitionRepository {
  constructor(private org: string, private db = requireDb()) { if (!org) throw new Error("Organisation required"); }
  async listMandates(): Promise<MandateView[]> {
    const rows = await this.db.select().from(mandates).where(eq(mandates.organizationId, this.org)).orderBy(desc(mandates.createdAt));
    return rows.map(row => {
      const parsed = briefSchema.safeParse((row.filters as Record<string, unknown>).brief);
      const brief = parsed.success ? parsed.data : { ...emptyBrief(), name: row.confirmation?.slice(0, 80) || "Imported mandate — review required", naturalLanguage: row.naturalLanguage };
      return { id: row.id, brief, createdAt: row.createdAt.toISOString() };
    });
  }
  async getMandate(id: string) { return (await this.listMandates()).find(m => m.id === id); }
  async saveBrief(brief: AcquisitionBrief, actorId: string, id?: string) {
    const values = { filters: { ...briefToMandate(brief), brief }, naturalLanguage: brief.naturalLanguage, confirmation: brief.name, provenance: { source: "Reviewed structured brief", capturedAt: new Date().toISOString() } };
    if (id) {
      const rows = await this.db.update(mandates).set(values).where(and(eq(mandates.id, id), eq(mandates.organizationId, this.org))).returning({ id: mandates.id });
      if (!rows.length) throw new Error("Mandate not found");
    } else {
      const [row] = await this.db.insert(mandates).values({ ...values, organizationId: this.org, createdBy: actorId }).returning({ id: mandates.id });
      id = row.id;
    }
    await new OrganizationRepository(this.db, this.org).appendAudit({ actorId, action: "mandate.brief_saved", entityType: "mandate", entityId: id });
    return id;
  }
  // Reads are scoped to the mandate's targets: the workspace polls this, so every
  // byte here is multiplied by open tabs. Optional target ids narrow it further.
  async memberships(mandateId: string, targetIds?: string[]): Promise<MembershipView[]> {
    const mandate = await this.getMandate(mandateId);
    if (!mandate) throw new Error("Mandate not found");
    const links = await this.db.select().from(mandateTargets).where(and(eq(mandateTargets.organizationId, this.org), eq(mandateTargets.mandateId, mandateId), targetIds ? inArray(mandateTargets.targetId, targetIds) : undefined));
    const ids = links.map(link => link.targetId);
    if (!ids.length) return [];
    const [ranked, rows, orgRows, findings] = await Promise.all([
      new OrganizationRepository(this.db, this.org).listRankedTargets(ids),
      this.db.select({ id: targets.id, accreditations: sql<Accreditation[] | null>`${targets.firmographics}->'accreditations'` }).from(targets).where(and(eq(targets.organizationId, this.org), inArray(targets.id, ids))),
      this.db.select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, this.org)),
      this.db.select({ finding: researchFindings }).from(researchFindings).where(and(eq(researchFindings.organizationId, this.org), inArray(researchFindings.targetId, ids))).orderBy(desc(researchFindings.observedAt)),
    ]);
    return links.flatMap(link => {
      const target = ranked.find(t => t.id === link.targetId);
      if (!target) return [];
      const assessment = assessmentSchema.safeParse(link.assessment);
      const accreditations = rows.find(r => r.id === target.id)?.accreditations;
      return [{ researchFindings: findings.filter(({ finding }) => finding.targetId === target.id).map(({ finding }) => ({ ...finding, evidence: finding.evidence as import("@/domain/research").ResearchFinding, observedAt: finding.observedAt.toISOString() })), target: assessMembership(target, mandate.brief, assessment.success ? assessment.data : initialAssessment, buyerProfileFromMetadata(orgRows[0]?.metadata)), assessment: assessment.success ? assessment.data : { ...initialAssessment }, accreditations: Array.isArray(accreditations) ? accreditations : [], version: link.version }];
    });
  }
  async attach(mandateId: string, targetId: string) {
    await this.attachMany(mandateId, [targetId]);
  }
  async attachMany(mandateId: string, targetIds: string[]) {
    const uniqueIds = [...new Set(targetIds)];
    if (!uniqueIds.length) return;
    if (!await this.getMandate(mandateId)) throw new Error("Mandate not found");
    const valid = await this.db.select({ id: targets.id }).from(targets).where(and(inArray(targets.id, uniqueIds), eq(targets.organizationId, this.org)));
    if (valid.length !== uniqueIds.length) throw new Error("Target not found");
    await this.db.insert(mandateTargets).values(valid.map(({ id: targetId }) => ({ organizationId: this.org, mandateId, targetId, assessment: initialAssessment }))).onConflictDoNothing();
  }
  async saveAssessment(mandateId: string, targetId: string, assessment: Assessment, version: number, actorId: string) {
    const rows = await this.db.update(mandateTargets).set({ assessment, version: sql`${mandateTargets.version} + 1`, updatedAt: new Date() }).where(and(eq(mandateTargets.organizationId, this.org), eq(mandateTargets.mandateId, mandateId), eq(mandateTargets.targetId, targetId), eq(mandateTargets.version, version))).returning({ version: mandateTargets.version });
    if (!rows.length) throw new Error("This assessment changed or no longer exists. Reload before saving.");
    await new OrganizationRepository(this.db, this.org).appendAudit({ actorId, action: "mandate.assessment_saved", entityType: "target", entityId: targetId, metadata: { mandateId, stage: assessment.stage } });
    return rows[0].version;
  }
  async saveAccreditations(mandateId: string, targetId: string, accreditations: Accreditation[]) {
    if (!(await this.memberships(mandateId, [targetId])).length) throw new Error("Target not found in mandate");
    await this.db.update(targets).set({ firmographics: sql`jsonb_set(${targets.firmographics}, '{accreditations}', ${JSON.stringify(accreditations)}::jsonb)`, updatedAt: new Date() }).where(and(eq(targets.id, targetId), eq(targets.organizationId, this.org)));
  }
  async coverage(mandateId: string): Promise<CoverageRun[]> {
    return (await this.db.select().from(coverageRuns).where(and(eq(coverageRuns.organizationId, this.org), eq(coverageRuns.mandateId, mandateId))).orderBy(desc(coverageRuns.createdAt))).map(r => ({ id: r.id, sources: r.sources as CoverageSource[], createdAt: r.createdAt.toISOString() }));
  }
  async recordCoverage(mandateId: string, sources: CoverageSource[]) { await this.db.insert(coverageRuns).values({ organizationId: this.org, mandateId, sources }); }
  async valuations(mandateId: string) { return (await this.db.select().from(valuationObservations).where(and(eq(valuationObservations.organizationId, this.org), eq(valuationObservations.mandateId, mandateId))).orderBy(desc(valuationObservations.createdAt))).map(r => r.observation as ValuationObservation); }
  async saveValuation(mandateId: string, observation: ValuationObservation) {
    await this.db.insert(valuationObservations).values({ id: observation.id, organizationId: this.org, mandateId, observation });
  }
}
