import { dispatchBusinessPeople } from "@/lib/business-research-people";
import { and, eq } from "drizzle-orm";
import { requireDb } from "@/db/client";
import { researchFindings } from "@/db/schema";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { OrganizationRepository } from "@/db/repositories";
import { briefToMandate } from "@/domain/acquisition";
import { findingSchema, publicResearchUrl } from "@/domain/research";
import { mapGooglePlace } from "@/adapters/firmable-mapper";
import { rankTarget } from "@/domain/scoring";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { ResearchRepository } from "@/db/research-repository";
import { researchEnabled, researchWorker } from "@/lib/research-service";
export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session.activeOrganizationId)
    return Response.json({ error: "Sign in first" }, { status: 401 });
  if (!researchEnabled())
    return Response.json({ error: "Research unavailable" }, { status: 503 });
  const { jobId } = await context.params;
  if (!z.string().uuid().safeParse(jobId).success)
    return Response.json({ error: "Invalid job" }, { status: 400 });
  const body = z
    .object({
      action: z.enum(["cancel", "retry-dispatch", "accept", "resume-people"]),
      findingId: z.string().uuid().optional(),
    })
    .safeParse(await request.json().catch(() => null));
  if (!body.success)
    return Response.json({ error: "Invalid action" }, { status: 400 });
  const repo = new ResearchRepository(session.session.activeOrganizationId);
  const job = await repo.get(jobId);
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
  if (body.data.action === "resume-people") {
    try { await dispatchBusinessPeople(session.session.activeOrganizationId, jobId); return Response.json({ ok: true }); }
    catch { return Response.json({ error: "People research is waiting for the active research job to finish. Try again afterward." }, { status: 409 }); }
  }
  if (body.data.action === "accept") {
    if (!body.data.findingId)
      return Response.json({ error: "Finding required" }, { status: 400 });
    const org = session.session.activeOrganizationId;
    const database = requireDb();
    const [finding] = await database
      .select()
      .from(researchFindings)
      .where(
        and(
          eq(researchFindings.id, body.data.findingId),
          eq(researchFindings.jobId, jobId),
          eq(researchFindings.organizationId, org),
        ),
      );
    if (!finding)
      return Response.json({ error: "Finding not found" }, { status: 404 });
    if (finding.targetId)
      return Response.json({ ok: true, targetId: finding.targetId });
    const evidence = findingSchema.safeParse(finding.evidence);
    if (
      !evidence.success ||
      evidence.data.kind !== "company" ||
      !publicResearchUrl(evidence.data.website)
    )
      return Response.json(
        { error: "A sourced company website is required" },
        { status: 409 },
      );
    const acquisition = new AcquisitionRepository(org);
    const mandate = await acquisition.getMandate(job.mandateId);
    if (!mandate)
      return Response.json({ error: "Mandate not found" }, { status: 404 });
    const filters = briefToMandate(mandate.brief);
    const source = {
      recordId: finding.id,
      name: evidence.data.name,
      website: evidence.data.website,
      description: evidence.data.quote,
      categories: [],
      keywords: [],
      capabilities: [],
      sourceRecords: [
        {
          source: "Reviewed research finding",
          sourceId: finding.id,
          sourceUrl: finding.sourceUrl,
        },
      ],
    };
    const target = mapGooglePlace(
      {
        id: finding.id,
        name: evidence.data.name,
        website: evidence.data.website,
        formattedAddress: "Unknown",
        discoverySource: "manufacturing-directory",
        manufacturingDirectory: source,
      },
      filters,
      org,
      "Research candidate; qualification pending",
    );
    const saved = await new OrganizationRepository(
      database,
      org,
    ).upsertEnrichedTarget({
      target: rankTarget(target, filters),
      mandateId: job.mandateId,
      actorId: session.user.id,
    });
    if (!saved)
      return Response.json({ error: "Unable to add target" }, { status: 409 });
    await acquisition.attach(job.mandateId, saved.id);
    await database
      .update(researchFindings)
      .set({ targetId: saved.id })
      .where(
        and(
          eq(researchFindings.id, finding.id),
          eq(researchFindings.organizationId, org),
        ),
      );
    return Response.json({ ok: true, targetId: saved.id });
  }
  if (body.data.action === "cancel") {
    await repo.cancel(jobId);
    try {
      await researchWorker(`/jobs/${jobId}`, "DELETE");
    } catch {
      /* Durable workflow also checks cancellation while polling. */
    }
    // The workflow checks cancellation before each external action and during polling.
    return Response.json({
      ok: true,
      message:
        "Cancellation requested; an in-flight page may finish before the worker stops.",
    });
  }
  if (job.status !== "queued")
    return Response.json(
      { error: "Only queued jobs can be re-dispatched" },
      { status: 409 },
    );
  try {
    await researchWorker(`/jobs/${jobId}`, "POST");
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "Unable to dispatch. The saved job can be retried." },
      { status: 503 },
    );
  }
}
