import {refreshCompanyProjectionsAfterChange} from '@/lib/company-projection-refresh';
import { readableStoredBrief } from "@/domain/stored-brief";
import {loadMandateResearchStatuses} from './mandate-research-status';
import { and, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { requireDb } from "./client";
import { coverageRuns, mandates, mandateTargets, targets, valuationObservations, organization, researchFindings, signals } from "./schema";
import { OrganizationRepository } from "./repositories";
import { assessmentDecisionView, assessmentSchema, briefSchema, briefToMandate, emptyBrief, initialAssessment, type AcquisitionBrief, type Accreditation, type Assessment, type CoverageRun, type CoverageSource, type MandateView, type MembershipView, type ValuationObservation } from "@/domain/acquisition";
import { assessMembership } from "@/domain/mandate-assessment";
import {loadAcceptedCompanyObservations} from "./company-observation-read-model";
import {buildCompanyMembershipProjection} from "@/domain/company-membership-projection";
import {targetRecordToRankedTarget} from "./target-record-mapper";
import { buyerProfileFromMetadata } from "@/domain/buyer-profile";
import {buildDemoBuyerProfile,demoBuyerProfileStampSchema,resolveDemoBuyerProfile} from '@/lib/agent-demo-buyer-profile';

export class AcquisitionRepository {
  constructor(private org: string, private db = requireDb()) { if (!org) throw new Error("Organisation required"); }
  async listMandates(): Promise<MandateView[]> {
    const rows = await this.db.select({...getTableColumns(mandates),revision:sql<string>`xmin::text`}).from(mandates).where(eq(mandates.organizationId, this.org)).orderBy(desc(mandates.createdAt));
    const researchStatuses=await loadMandateResearchStatuses(this.db,this.org,rows.map(row=>row.id));
    return rows.map(row => {
      const parsed = briefSchema.safeParse(readableStoredBrief((row.filters as Record<string, unknown>).brief));
      const brief = parsed.success ? parsed.data : { ...emptyBrief(), name: row.confirmation?.slice(0, 80) || "Imported mandate — review required", naturalLanguage: row.naturalLanguage };
      return { id: row.id, brief, createdAt: row.createdAt.toISOString(), revision:row.revision,researchStatus:researchStatuses.get(row.id) };
    });
  }
  async getMandate(id: string): Promise<MandateView | undefined> {
    const [row] = await this.db.select({...getTableColumns(mandates),revision:sql<string>`xmin::text`}).from(mandates).where(and(eq(mandates.organizationId, this.org), eq(mandates.id, id))).limit(1);
    if (!row) return undefined;
    const parsed = briefSchema.safeParse(readableStoredBrief((row.filters as Record<string, unknown>).brief));
    const brief = parsed.success ? parsed.data : { ...emptyBrief(), name: row.confirmation?.slice(0, 80) || 'Imported mandate — review required', naturalLanguage: row.naturalLanguage };
    return { id: row.id, brief, createdAt: row.createdAt.toISOString(), revision:row.revision };
  }
  async updateBrief(raw: AcquisitionBrief, actorId: string, id: string, expectedRevision:string):Promise<MandateView> {
    const brief=briefSchema.parse(raw);
    if(!/^\d{1,30}$/.test(expectedRevision))throw new Error('Reload the saved brief before editing.');
    const filters={...briefToMandate(brief),brief};
    const provenance:Record<string,unknown>={source:'Reviewed structured brief',capturedAt:new Date().toISOString()};
    const installed=await this.db.execute(sql`SELECT to_regprocedure('public.communications_lock_send_gate(text)') IS NOT NULL AS installed,
      to_regclass('public.agent_mandate_execution_modes') IS NOT NULL AS demo_modes_installed,
      (SELECT m.provenance FROM mandates m WHERE m.id=${id}::uuid AND m.organization_id=${this.org} AND m.xmin::text=${expectedRevision}) AS mandate_provenance`);
    type BriefPreflight={installed:boolean;demo_modes_installed?:boolean;mandate_provenance?:unknown};
    const flags=(Array.isArray(installed)?installed:(installed as {rows:BriefPreflight[]}).rows) as BriefPreflight[];
    if(flags.length!==1||typeof flags[0].installed!=='boolean'||(!flags[0].installed&&process.env.COMMUNICATIONS_RUNTIME_ENABLED==='true'))throw new Error('Send authority unavailable');
    const savedProvenance=flags[0].mandate_provenance;
    const oldStamp=demoBuyerProfileStampSchema.safeParse(savedProvenance&&typeof savedProvenance==='object'&&!Array.isArray(savedProvenance)?(savedProvenance as Record<string,unknown>).demoBuyerProfile:undefined);
    // Verify only an existing server stamp. Ordinary and legacy real edits do
    // not depend on the optional native execution-mode relation. The original
    // xmin CAS below refuses any mandate change after this scoped preflight.
    if(flags[0].demo_modes_installed===true&&oldStamp.success&&oldStamp.data.mandateId===id){
      const modeResult=await this.db.execute(sql`SELECT mode,demo_id FROM public.agent_mandate_execution_modes WHERE mandate_id=${id}::uuid AND organization_id=${this.org}`);
      const modes=(Array.isArray(modeResult)?modeResult:(modeResult as {rows:{mode:string;demo_id:string|null}[]}).rows) as {mode:string;demo_id:string|null}[];
      if(modes.length===1&&resolveDemoBuyerProfile({executionMode:modes[0].mode,demoId:modes[0].demo_id,mandateId:id,provenance:savedProvenance}))provenance.demoBuyerProfile=buildDemoBuyerProfile(id,brief);
    }
    const gate=flags[0].installed?sql`SELECT public.communications_lock_send_gate(${this.org}) AS revision`:sql`SELECT 0::bigint AS revision`;
    // One statement keeps the audit and successful compare-and-swap atomic on
    // both supported PostgreSQL drivers, including the HTTP driver.
    const result=await this.db.execute(sql`WITH gate AS MATERIALIZED (${gate}), authorised AS MATERIALIZED (
      SELECT member.id FROM member CROSS JOIN gate WHERE member.organization_id=${this.org} AND member.user_id=${actorId} AND gate.revision IS NOT NULL FOR SHARE OF member
    ), changed AS (
      UPDATE mandates SET filters=${JSON.stringify(filters)}::jsonb,natural_language=${brief.naturalLanguage},confirmation=${brief.name},provenance=${JSON.stringify(provenance)}::jsonb
      FROM authorised WHERE mandates.id=${id}::uuid AND organization_id=${this.org} AND xmin::text=${expectedRevision}
      RETURNING mandates.id,created_at,xmin::text AS revision
    ), audited AS (
      INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata)
      SELECT ${this.org},${actorId},'mandate.brief_saved','mandate',id::text,jsonb_build_object('baseRevision',${expectedRevision}::text,'revision',revision) FROM changed RETURNING entity_id
    ) SELECT changed.* FROM changed JOIN audited ON audited.entity_id=changed.id::text`);
    const rows=(Array.isArray(result)?result:(result as {rows:{id:string;created_at:Date|string;revision:string}[]}).rows) as {id:string;created_at:Date|string;revision:string}[];
    if(!rows.length)throw new Error('The saved brief changed or is unavailable. Reload it before saving your changes.');
    const row=rows[0],companyProjectionRefresh=await refreshCompanyProjectionsAfterChange(this.db,{organizationId:this.org,userId:actorId},{mandateId:row.id});return {id:row.id,brief,createdAt:new Date(row.created_at).toISOString(),revision:row.revision,companyProjectionRefresh};
  }
  async saveBrief(brief: AcquisitionBrief, actorId: string, id?: string) {
    const values = { filters: { ...briefToMandate(brief), brief }, naturalLanguage: brief.naturalLanguage, confirmation: brief.name, provenance: { source: "Reviewed structured brief", capturedAt: new Date().toISOString() } };
    if (id) {
      throw new Error('Use updateBrief with the reviewed base revision to edit an existing mandate.');
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
    const observations=await loadAcceptedCompanyObservations(this.db,this.org,mandateId,ids);
    const acceptedIds=ids.filter(id=>observations.has(id)),legacyIds=ids.filter(id=>!observations.has(id));
    const [ranked, rows, orgRows, findings, acceptedRows, canonicalSignals] = await Promise.all([
      legacyIds.length?new OrganizationRepository(this.db, this.org).listRankedTargets(legacyIds):Promise.resolve([]),
      this.db.select({ id: targets.id, accreditations: sql<Accreditation[] | null>`${targets.firmographics}->'accreditations'` }).from(targets).where(and(eq(targets.organizationId, this.org), inArray(targets.id, ids))),
      this.db.select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, this.org)),
      this.db.select({ finding: researchFindings }).from(researchFindings).where(and(eq(researchFindings.organizationId, this.org), inArray(researchFindings.targetId, ids))).orderBy(desc(researchFindings.observedAt)),
      acceptedIds.length?this.db.select().from(targets).where(and(eq(targets.organizationId,this.org),inArray(targets.id,acceptedIds))):Promise.resolve([]),
      acceptedIds.length?this.db.select().from(signals).where(and(eq(signals.organizationId,this.org),inArray(signals.targetId,acceptedIds))):Promise.resolve([]),
    ]);
    return links.flatMap(link => {
      const observation=observations.get(link.targetId);
      if(observation){
        const record=acceptedRows.find(row=>row.id===link.targetId);
        if(!record)return [];
        const savedAssessment=assessmentSchema.safeParse(link.assessment);
        const currentFindings=findings.filter(({finding})=>finding.targetId===link.targetId&&finding.mandateId===mandateId).map(({finding})=>({...finding,evidence:finding.evidence as import("@/domain/research").ResearchFinding,observedAt:finding.observedAt.toISOString()}));
        const projection=buildCompanyMembershipProjection({targetRecord:record,brief:mandate.brief,assessment:savedAssessment.success?savedAssessment.data:{...initialAssessment},findings:currentFindings,observation});
        // Start from the canonical raw row: the global Firmable response overlay
        // must not supersede this mandate's accepted observation. Signals retain
        // their canonical provenance; this buyer's assessment is recomputed.
        const target=targetRecordToRankedTarget(projection.effectiveTargetRecord,canonicalSignals.filter(signal=>signal.targetId===link.targetId));
        const observedAccreditations=(projection.effectiveTargetRecord.firmographics as Record<string,unknown>).accreditations;
        return [{researchFindings:currentFindings,target:assessMembership(target,mandate.brief,projection.effectiveAssessment,buyerProfileFromMetadata(orgRows[0]?.metadata),currentFindings),assessment:projection.effectiveAssessment,accreditations:Array.isArray(observedAccreditations)?observedAccreditations as Accreditation[]:[],version:link.version}];
      }
      const target = ranked.find(t => t.id === link.targetId);
      if (!target) return [];
      const assessment = assessmentSchema.safeParse(link.assessment);
      const accreditations = rows.find(r => r.id === target.id)?.accreditations;
      const targetFindings = findings.filter(({ finding }) => finding.targetId === target.id).map(({ finding }) => ({ ...finding, evidence: finding.evidence as import("@/domain/research").ResearchFinding, observedAt: finding.observedAt.toISOString() }));
      const decision=assessmentDecisionView(mandate.brief,target,assessment.success ? assessment.data : {...initialAssessment});
      return [{ researchFindings: targetFindings, target: assessMembership(target, mandate.brief, decision, buyerProfileFromMetadata(orgRows[0]?.metadata), targetFindings), assessment: decision, accreditations: Array.isArray(accreditations) ? accreditations : [], version: link.version }];
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
    const companyProjectionRefresh=await refreshCompanyProjectionsAfterChange(this.db,{organizationId:this.org,userId:actorId},{mandateId,targetIds:[targetId]});
    return {version:rows[0].version,companyProjectionRefresh};
  }
  async saveAccreditations(mandateId: string, targetId: string, accreditations: Accreditation[], actorId:string) {
    if (!(await this.memberships(mandateId, [targetId])).length) throw new Error("Target not found in mandate");
    await this.db.update(targets).set({ firmographics: sql`jsonb_set(${targets.firmographics}, '{accreditations}', ${JSON.stringify(accreditations)}::jsonb)`, updatedAt: new Date() }).where(and(eq(targets.id, targetId), eq(targets.organizationId, this.org)));
    return {companyProjectionRefresh:await refreshCompanyProjectionsAfterChange(this.db,{organizationId:this.org,userId:actorId},{mandateId,targetIds:[targetId]})};
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
