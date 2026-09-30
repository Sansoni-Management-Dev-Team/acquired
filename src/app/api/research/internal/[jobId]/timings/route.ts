import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireDb } from '@/db/client';
import { researchJobs } from '@/db/schema';
import { saveResearchTimingSpans } from '@/db/research-timing-repository';
import { researchTimingBatchSchema } from '@/domain/research-timing';
import { researchEnabled, researchServiceAuthorized } from '@/lib/research-service';

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  if (!researchServiceAuthorized(request) || !researchEnabled()) return Response.json({ error: 'Not available' }, { status: 403 });
  const { jobId } = await context.params;
  if (!z.string().uuid().safeParse(jobId).success) return Response.json({ error: 'Invalid job' }, { status: 400 });
  const batch = researchTimingBatchSchema.safeParse(await request.json().catch(() => null));
  if (!batch.success) return Response.json({ error: 'Invalid timing spans' }, { status: 400 });
  const [job] = await requireDb().select({ organizationId: researchJobs.organizationId }).from(researchJobs).where(eq(researchJobs.id, jobId)).limit(1);
  if (!job) return Response.json({ error: 'Not available' }, { status: 404 });
  await saveResearchTimingSpans(jobId, job.organizationId, batch.data.spans);
  return Response.json({ ok: true });
}
