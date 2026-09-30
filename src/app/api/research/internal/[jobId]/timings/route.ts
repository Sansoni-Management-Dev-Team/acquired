import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireDb } from '@/db/client';
import { researchJobs } from '@/db/schema';
import { saveResearchTimingSpans } from '@/db/research-timing-repository';
import { researchTimingBatchSchema } from '@/domain/research-timing';
import { researchEnabled, researchServiceAuthorized } from '@/lib/research-service';
import { observeResearchRequest, researchRequestJson, researchJsonResponse, setResearchDatabaseContext } from '@/lib/research-request-observability';

async function deliverTimings(request: Request, context: { params: Promise<{ jobId: string }> }) {
  if (!researchServiceAuthorized(request) || !researchEnabled()) return researchJsonResponse({ error: 'Not available' }, { status: 403 });
  const { jobId } = await context.params;
  if (!z.string().uuid().safeParse(jobId).success) return researchJsonResponse({ error: 'Invalid job' }, { status: 400 });
  const batch = researchTimingBatchSchema.safeParse(await researchRequestJson(request).catch(() => null));
  if (!batch.success) return researchJsonResponse({ error: 'Invalid timing spans' }, { status: 400 });
  const [job] = await requireDb().select({ organizationId: researchJobs.organizationId }).from(researchJobs).where(eq(researchJobs.id, jobId)).limit(1);
  if (!job) return researchJsonResponse({ error: 'Not available' }, { status: 404 });
  setResearchDatabaseContext({ jobId, organizationId: job.organizationId, stage: 'telemetry', action: 'timings' });
  await saveResearchTimingSpans(jobId, job.organizationId, batch.data.spans);
  return researchJsonResponse({ ok: true });
}
export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) { return observeResearchRequest(request, () => deliverTimings(request, context)); }
