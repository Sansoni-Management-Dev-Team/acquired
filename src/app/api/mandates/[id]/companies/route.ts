import { researchJsonResponse } from "@/lib/research-request-observability";
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { CompanyListRepository } from '@/db/company-list-repository';
import { recoverCompanyListWork } from '@/lib/company-list-recovery';
import { observeResearchRequest } from '@/lib/research-request-observability';
import { AcquisitionRepository } from '@/db/acquisition-repository';

const querySchema = z.object({ search: z.string().max(300).default(''), stage: z.string().max(40).default('all'), research: z.enum(['all','ready','researching','needs-evidence']).default('all'), data: z.enum(['all','headcount','revenue','person']).default('all'), accreditation: z.string().max(300).default(''), page: z.coerce.number().int().min(1).max(100000).default(1), revision: z.string().regex(/^[a-f0-9]{64}$/).optional() });
type Context = { params: Promise<{ id: string }> };
async function handle(request: Request, context: Context) {
  const session = await auth.api.getSession({ headers: request.headers });
  const org = session?.session.activeOrganizationId;
  if (!org) return researchJsonResponse({ error: 'Sign in first' }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return researchJsonResponse({ error: 'Invalid mandate' }, { status: 400 });
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return researchJsonResponse({ error: 'Invalid company filters' }, { status: 400 });
  const { revision, ...query } = parsed.data;
  if (request.method === 'POST') {
    if (!await new AcquisitionRepository(org).getMandate(id)) return researchJsonResponse({ error: 'Mandate not found' }, { status: 404 });
    await recoverCompanyListWork(org, id);
    return researchJsonResponse({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const result = await new CompanyListRepository(org).load(id, query, revision);
  if (!result) return researchJsonResponse({ error: 'Mandate not found' }, { status: 404 });
  return researchJsonResponse(result, { headers: { 'Cache-Control': 'no-store' } });
}
export async function GET(request: Request, context: Context) { return observeResearchRequest(request, () => handle(request, context)); }
export async function POST(request: Request, context: Context) { return observeResearchRequest(request, () => handle(request, context)); }
