import { z } from "zod";
import { auth } from "@/lib/auth";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { ResearchRepository } from "@/db/research-repository";
import {
  researchStartSchema,
  terminalResearchStates,
  continueResearchConfig,
  type ResearchConfig,
} from "@/domain/research";
import { researchEnabled, researchWorker } from "@/lib/research-service";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session.activeOrganizationId)
    return Response.json({ error: "Sign in first" }, { status: 401 });
  if (!researchEnabled())
    return Response.json({ enabled: false, jobs: [], findings: [] });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success)
    return Response.json({ error: "Invalid mandate" }, { status: 400 });
  const org = session.session.activeOrganizationId;
  if (!(await new AcquisitionRepository(org).getMandate(id)))
    return Response.json({ error: "Mandate not found" }, { status: 404 });
  const repo = new ResearchRepository(org);
  const [jobs, findings] = await Promise.all([
    repo.list(id),
    repo.findings(id),
  ]);
  return Response.json(
    { enabled: true, jobs: jobs.filter(j => (j.config as ResearchConfig).purpose !== "people"), findings: findings.filter(f => (f.evidence as { kind?: string }).kind !== "person") },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session.activeOrganizationId)
    return Response.json({ error: "Sign in first" }, { status: 401 });
  if (!researchEnabled())
    return Response.json(
      { error: "Research is awaiting service activation" },
      { status: 503 },
    );
  const parsed = researchStartSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  const { id } = await context.params;
  const org = session.session.activeOrganizationId;
  if (!z.string().uuid().safeParse(id).success)
    return Response.json({ error: "Invalid mandate" }, { status: 400 });
  if (!(await new AcquisitionRepository(org).getMandate(id)))
    return Response.json({ error: "Mandate not found" }, { status: 404 });
  const { requestId, continueFrom, ...submitted } = parsed.data;
  let config: ResearchConfig = submitted;
  if (continueFrom) {
    const repo = new ResearchRepository(org);
    const prior = await repo.get(continueFrom);
    if (!prior || prior.mandateId !== id)
      return Response.json(
        { error: "Previous job not found" },
        { status: 404 },
      );
    if (!terminalResearchStates.includes(prior.status))
      return Response.json(
        { error: "Wait for the previous job to finish" },
        { status: 409 },
      );
    const found = (await repo.findings(id))
      .filter((f) => f.jobId === continueFrom)
      .map((f) => f.sourceUrl);
    if ((prior.config as ResearchConfig).purpose === "people") return Response.json({ error: "Start people research from the company contact panel" }, { status: 409 });
    config = continueResearchConfig(
      prior.config as ResearchConfig,
      prior.seeds as string[],
      found,
      submitted.budget,
      continueFrom,
    );
    config.strategy = submitted.strategy || "discover";
    if (!config.runtime?.remaining.length)
      return Response.json(
        {
          error:
            "No saved URLs remain. Set up a new search or retry a failed URL explicitly.",
        },
        { status: 409 },
      );
  }
  try {
    const job = await new ResearchRepository(org).create(
      requestId,
      id,
      session.user.id,
      config,
    );
    if (!terminalResearchStates.includes(job.status)) {
      try {
        await researchWorker(`/jobs/${job.id}`, "POST");
      } catch {
        return Response.json(
          {
            jobId: job.id,
            message:
              "Job saved. Dispatch uncertain; retry this job to reconnect without duplicating it.",
          },
          { status: 202 },
        );
      }
    }
    return Response.json({ jobId: job.id }, { status: 202 });
  } catch {
    return Response.json(
      {
        error:
          "Another research job is active. Wait for it to finish or cancel it.",
      },
      { status: 409 },
    );
  }
}
