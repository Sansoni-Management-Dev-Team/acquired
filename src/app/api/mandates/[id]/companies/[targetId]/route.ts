import { z } from 'zod';
import { auth } from '@/lib/auth';
import { AcquisitionRepository } from '@/db/acquisition-repository';
import { companyCompleteness } from '@/domain/research-completeness';
export async function GET(request: Request, { params }: { params: Promise<{ id: string; targetId: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  const org = session?.session.activeOrganizationId;
  if (!org) return Response.json({ error: 'Sign in first' }, { status: 401 });
  const { id, targetId } = await params;
  if (![id,targetId].every(value => z.uuid().safeParse(value).success)) return Response.json({ error: 'Invalid company' }, { status: 400 });
  const repo = new AcquisitionRepository(org);
  const mandate = await repo.getMandate(id);
  if (!mandate) return Response.json({ error: 'Mandate not found' }, { status: 404 });
  const member = (await repo.memberships(id, [targetId]))[0];
  return member ? Response.json({ member, completeness: companyCompleteness(member, mandate.brief) }, { headers: { 'Cache-Control': 'no-store' } }) : Response.json({ error: 'Company not found' }, { status: 404 });
}
