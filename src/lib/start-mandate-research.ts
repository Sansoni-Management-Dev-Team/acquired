import {withResearchJobWorkflow} from '@/lib/acquisition-workflow-context';
import { buildAllDiscoveredCompanyPeoplePolicy } from "@/domain/research-discovery-policy";
import { selectedResearchPipeline } from "@/domain/research-pipeline-design";
import { newResearchPerformanceFlags } from "@/lib/research-performance-flags";
import { automaticResearchConfig } from "@/domain/automatic-research";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireDb } from "@/db/client";
import { organization } from "@/db/schema";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { MandateResearchRevisionError, ResearchRepository, type ResearchStartAdmission } from "@/db/research-repository";
import { researchStartSchema, terminalResearchStates, continueResearchConfig, type ResearchConfig } from "@/domain/research";
import { researchEnabled, researchWorker } from "@/lib/research-service";
import { briefResearchGeography, briefResearchSources, generateBriefResearchScope } from "@/lib/brief-research";
import { researchSettingsFromMetadata } from "@/domain/research-settings";
import {withResearchDatabaseContext} from './research-request-observability';
import {safeResearchTrace} from '@/domain/research-trace-context';

export type MandateResearchActor = { organizationId: string; userId: string };
export type MandateResearchStartOptions = ResearchStartAdmission;
export type MandateResearchStartResult =
  | { status: 202; body: { jobId: string; message?: string } }
  | { status: 400 | 404 | 409 | 422 | 503; body: { error: string } };

function researchStartResult(body: { error: string }, init: { status: 400 | 404 | 409 | 422 | 503 }): MandateResearchStartResult;
function researchStartResult(body: { jobId: string; message?: string }, init: { status: 202 }): MandateResearchStartResult;
function researchStartResult(body: MandateResearchStartResult["body"], init: { status: MandateResearchStartResult["status"] }): MandateResearchStartResult {
  return { status: init.status, body } as MandateResearchStartResult;
}

/** Server application action shared by authenticated GUI and agent submission.
 * Callers supply a trusted session actor; client input never supplies authority.
 * Existing saved continuations keep their original policy and dispatch identity.
 */
export async function startMandateResearch(
  actor: MandateResearchActor,
  id: string,
  body: unknown,
  options: MandateResearchStartOptions = {},
): Promise<MandateResearchStartResult> {
  const requestId=body&&typeof body==='object'&&'requestId' in body&&typeof body.requestId==='string'?body.requestId:undefined;
  const trace=safeResearchTrace({mandateId:id,jobId:requestId,runId:requestId});
  return withResearchDatabaseContext({...trace,organizationId:actor.organizationId,stage:'research-launch',action:'start'},()=>startMandateResearchAction(actor,id,body,options));
}
async function startMandateResearchAction(
  actor: MandateResearchActor,
  id: string,
  body: unknown,
  options: MandateResearchStartOptions = {},
): Promise<MandateResearchStartResult> {
  if (options.initialResponsibility && options.expectedMandateRevision === undefined)
    return researchStartResult({ error: "Current mandate revision is required for initial agent research." }, { status: 409 });
  if (!researchEnabled())
    return researchStartResult(
      { error: "Research is awaiting service activation" },
      { status: 503 },
    );
  if(body&&typeof body==='object'&&Object.hasOwn(body,'companyContinuation'))return researchStartResult({error:'Prepare remaining-company work through its current agent review.'},{status:400});
  const briefStart = z.object({ requestId: z.string().uuid(), fromBrief: z.literal(true) }).safeParse(body);
  const parsed = briefStart.success ? null : researchStartSchema.safeParse(body);
  if (!briefStart.success && !parsed?.success)
    return researchStartResult(
      { error: parsed?.error.issues.map((i) => i.message).join("; ") || "Invalid research request" },
      { status: 400 },
    );
  const org = actor.organizationId;
  if (!z.string().uuid().safeParse(id).success)
    return researchStartResult({ error: "Invalid mandate" }, { status: 400 });
  const mandate = await new AcquisitionRepository(org).getMandate(id);
  if (!mandate)
    return researchStartResult({ error: "Mandate not found" }, { status: 404 });
  if (options.expectedMandateRevision !== undefined && mandate.revision !== options.expectedMandateRevision)
    return researchStartResult({ error: "The mandate changed before research started. Submit the current brief again." }, { status: 409 });
  let input: z.infer<typeof researchStartSchema>;
  if (briefStart.success) {
    try {
      const [row] = await requireDb().select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, org)).limit(1);
      const targetBusinesses = researchSettingsFromMetadata(row?.metadata).defaultTargetBusinesses;
      const geography = briefResearchGeography(mandate.brief);
      const seeds = briefResearchSources(mandate.brief);
      const scope = await generateBriefResearchScope(mandate.brief);
      input = researchStartSchema.parse({
        requestId: briefStart.data.requestId,
        seeds,
        searchTerms: [],
        researchScope: scope,
        geography,
        discover: true,
        strategy: "discover",
        workflow: "business",
        mode: "automatic",
        targetBusinesses,
        findPeople: true,
        peopleSearchesPerCompany: 2,
        peopleBudget: { maxCompanies: targetBusinesses, maxPages: 12 },
        companyBudget: { maxCompanies: 2, maxPages: 3 },
        approved: true,
        budget: { maxPages: 5, maxDomains: 5, maxMinutes: 10, maxModelCalls: 5 },
      });
    } catch (error) {
      return researchStartResult({ error: error instanceof Error ? error.message : "Could not prepare research from the brief." }, { status: 422 });
    }
  } else input = parsed!.data!;
  const { requestId, continueFrom, ...submitted } = input;
  let config: ResearchConfig = { ...submitted, searchTerms: submitted.searchTerms.length ? submitted.searchTerms : submitted.researchScope!.split(/[;\n]/).map(s => s.trim().slice(0, 160)).filter(s => s.length >= 2).slice(0, 6) };
  let savedFirmableContinuation = false;
  let savedWorkflowJob: {workflowExecutionId:string;organizationId:string;createdBy:string}|undefined;
  if (continueFrom) {
    const repo = new ResearchRepository(org);
    const prior = await repo.get(continueFrom);
    if (!prior || prior.mandateId !== id)
      return researchStartResult(
        { error: "Previous job not found" },
        { status: 404 },
      );
    if(prior.workflowExecutionId){
      if(prior.createdBy!==actor.userId)return researchStartResult({error:'Previous job not found'},{status:404});
      savedWorkflowJob={workflowExecutionId:prior.workflowExecutionId,organizationId:org,createdBy:prior.createdBy};
    }
    if (!terminalResearchStates.includes(prior.status))
      return researchStartResult(
        { error: "Wait for the previous job to finish" },
        { status: 409 },
      );
    const found = (await repo.findings(id))
      .filter((f) => f.jobId === continueFrom)
      .map((f) => f.sourceUrl);
    if ((prior.config as ResearchConfig).purpose) return researchStartResult({ error: "Start people research from the company contact panel" }, { status: 409 });
    config = continueResearchConfig(
      prior.config as ResearchConfig,
      prior.seeds as string[],
      found,
      submitted.budget,
      continueFrom,
    );
    savedFirmableContinuation = ['firmable-v1','web-firmable-v1','hybrid-firmable-v1'].includes(config.pipelineDesign || '');
    config.strategy = submitted.strategy || "discover";
    if (config.workflow === "business" && !savedFirmableContinuation) {
      config.findPeople = submitted.findPeople === true && submitted.budget.maxModelCalls > 0;
      config.peopleBudget = config.findPeople ? submitted.peopleBudget : undefined;
      config.companyBudget = submitted.companyBudget;
    }
    if (!config.runtime?.remaining.length)
      return researchStartResult(
        {
          error:
            "No saved URLs remain. Set up a new search or retry a failed URL explicitly.",
        },
        { status: 409 },
      );
  }
  if (config.mode === "automatic" && config.workflow === "business" && !savedFirmableContinuation) {
    config.findPeople = true;
    config.peopleBudget = { maxCompanies: config.targetBusinesses || 20, maxPages: 12 };
  }
  if (!continueFrom) config.performanceFlags = newResearchPerformanceFlags();
  config = automaticResearchConfig(config);
  if(!continueFrom)config.pipelineDesign=selectedResearchPipeline(config,process.env.RESEARCH_PIPELINE_DESIGN,process.env.LOCAL_DEVELOPMENT==='true');
  if(!continueFrom&&['firmable-v1','web-firmable-v1','hybrid-firmable-v1'].includes(config.pipelineDesign||'')){
    config.companyIdentityPolicyVersion=1;
    config.companyDiscoveryQueryPolicyVersion=1;
    // New standard AU roots enrich every discovered identity within saved bounds. Saved
    // continuations and custom caps retain their original execution semantics.
    delete config.companyDiscoveryPolicy;
    if(config.pipelineDesign==='hybrid-firmable-v1'&&config.targetBusinesses===20&&/^(?:Australia|National|(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA)(?:,\s*(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA))*)$/i.test(config.geography.trim())){
      config.companyDiscoveryPolicy=buildAllDiscoveredCompanyPeoplePolicy();
    }
  }
  if(!continueFrom&&['firmable-v1','web-firmable-v1','hybrid-firmable-v1'].includes(config.pipelineDesign||'')){
    // Fresh Firmable roots retrieve basic People through the shared bounded
    // capability. This flag never starts the separate AI website People loop.
    delete config.companyOnly;
    config.includeCompanyPeople=true;config.includePhones=false;config.findPeople=false;
    config.parallelBusinessResearch=false;
    config.completionPolicy='work-items';
    delete config.automaticDeadline;
  }
  if (config.mode === "automatic") config.researchRunId = requestId;
  try {
    const repo = new ResearchRepository(org);
    if (config.mode === "automatic" && !await repo.concurrentResearchReady()) return researchStartResult({ error: "Automatic research is awaiting the research concurrency database upgrade." }, { status: 503 });
    if (config.mode === "automatic" && await repo.hasOtherActive(requestId, id)) return researchStartResult({ error: "Research is already running for this mandate. Stop it before starting another run here." }, { status: 409 });
    if (options.expectedMandateRevision !== undefined) {
      const current = await new AcquisitionRepository(org).getMandate(id);
      if (!current || current.revision !== options.expectedMandateRevision)
        return researchStartResult({ error: "The mandate changed before research started. Submit the current brief again." }, { status: 409 });
    }
    const create = () => options.expectedMandateRevision === undefined
      ? repo.create(requestId, id, actor.userId, config)
      : repo.create(requestId, id, actor.userId, config, options);
    const job = await (savedWorkflowJob ? withResearchJobWorkflow(savedWorkflowJob,create) : create());
    // Insertion is the admission point. A later Pause does not retroactively
    // cancel this ordinary research root; the existing research Stop action does.
    if (!terminalResearchStates.includes(job.status)) {
      try {
        await researchWorker(`/jobs/${job.id}`, "POST");
      } catch {
        return researchStartResult(
          {
            jobId: job.id,
            message:
              "Job saved. Dispatch uncertain; retry this job to reconnect without duplicating it.",
          },
          { status: 202 },
        );
      }
    }
    return researchStartResult({ jobId: job.id }, { status: 202 });
  } catch (error) {
    if (error instanceof MandateResearchRevisionError)
      return researchStartResult({ error: error.message }, { status: 409 });
    return researchStartResult(
      {
        error:
          "Another research job is active. Wait for it to finish or cancel it.",
      },
      { status: 409 },
    );
  }
}
