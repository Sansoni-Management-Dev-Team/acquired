import { z } from "zod";
import { sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { loadOutreach } from "@/db/outreach-view";
import { requireDb } from "@/db/client";
import { FirmableHistoryRepository } from "@/db/firmable-history-repository";
const nativePeopleRow=z.object({id:z.uuid(),rootStatus:z.string(),operationState:z.string(),profilesFound:z.coerce.number().int().min(0).max(3),profilesSaved:z.coerce.number().int().min(0).max(3),result:z.unknown(),createdAt:z.coerce.date(),updatedAt:z.coerce.date()});
const nativePeopleResult=z.object({status:z.enum(['complete','partial']),saved:z.number().int().min(0).max(3),needsReview:z.number().int().min(0).max(3)});
const active=(run:{status:string}|undefined)=>Boolean(run&&['queued','running'].includes(run.status));
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  const org = session?.session.activeOrganizationId;
  if (!org) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Invalid mandate" }, { status: 400 });
  const mandate = await new AcquisitionRepository(org).getMandate(id);
  if (!mandate) return Response.json({ error: "Mandate not found" }, { status: 404 });
  const targetId = new URL(request.url).searchParams.get('targetId') || undefined;
  if (targetId && !z.uuid().safeParse(targetId).success) return Response.json({ error: 'Invalid company' }, { status: 400 });
  if (targetId && !(await new AcquisitionRepository(org).memberships(id, [targetId])).some(item => item.target.id === targetId)) return Response.json({ error: 'Company not found' }, { status: 404 });
  const database=requireDb(),history = new FirmableHistoryRepository(database);
  const runs = targetId ? await history.latestRuns(org, [targetId]) : [];
  // A native V5 phase owns its inline People work; it deliberately does not
  // fabricate a manual sync run. Project saved progress into the same read UI.
  const nativeRead=targetId?await database.execute(sql`SELECT child.id,root.status AS "rootStatus",parent.state AS "operationState",root.created_at AS "createdAt",child.updated_at AS "updatedAt",child.config->'automaticPeopleResult' AS result,
    jsonb_array_length(CASE WHEN jsonb_typeof(root.config->'automaticPeopleCompanies'->${targetId}::text->'candidates')='array' THEN root.config->'automaticPeopleCompanies'->${targetId}::text->'candidates' ELSE '[]'::jsonb END) AS "profilesFound",
    (SELECT count(*)::int FROM jsonb_each(CASE WHEN jsonb_typeof(root.config->'automaticPeopleCompanies'->${targetId}::text->'outcomes')='object' THEN root.config->'automaticPeopleCompanies'->${targetId}::text->'outcomes' ELSE '{}'::jsonb END)) AS "profilesSaved"
    FROM research_jobs root
    JOIN agent_operations parent ON parent.id::text=root.config->'nativeAgent'->>'operationId' AND parent.organization_id=root.organization_id AND parent.mandate_id=root.mandate_id AND parent.owner_user_id=root.created_by AND parent.name='research.start' AND parent.input->'config'->'companyDiscoveryPolicy'->>'version'='5'
    JOIN LATERAL (SELECT candidate.id,candidate.config,candidate.updated_at FROM research_jobs candidate WHERE candidate.organization_id=root.organization_id AND candidate.mandate_id=root.mandate_id AND candidate.created_by=root.created_by AND candidate.config->>'parentJobId'=root.id::text AND candidate.config->>'targetId'=${targetId} AND candidate.config->>'researchTask'='company' AND candidate.config->'companyIdentity'->>'status'='persisted' AND candidate.status IN('complete','partial') ORDER BY candidate.updated_at DESC,candidate.id LIMIT 1) child ON true
    WHERE root.organization_id=${org} AND root.mandate_id=${id}::uuid AND root.created_by=${session.user.id} AND root.config->'companyDiscoveryPolicy'->>'version'='5' AND root.config->>'includeCompanyPeople'='true' AND root.config->>'includePhones'='false' AND root.config->'nativeAgent'->>'providerAdmission'='hybrid-company-v1'
    ORDER BY CASE WHEN root.status IN('queued','discovering','extracting','crawling') AND parent.state='running' THEN 0 ELSE 1 END,root.created_at DESC,root.id LIMIT 2`):{rows:[]};
  const parsed=z.object({rows:z.array(nativePeopleRow)}).safeParse(nativeRead);
  if(!parsed.success)return Response.json({error:'Contact research status needs review'},{status:409,headers:{'Cache-Control':'no-store'}});
  const nativeRuns=parsed.data.rows.map(row=>{
    const result=nativePeopleResult.safeParse(row.result),unfinished=['queued','discovering','extracting','crawling'].includes(row.rootStatus)&&row.operationState==='running';
    return{id:row.id,status:result.success?result.data.status:unfinished&&row.result==null?'running':'partial',profilesFound:row.profilesFound,profilesSaved:result.success?Math.max(result.data.saved,row.profilesSaved):row.profilesSaved,source:'native_automatic_people',createdAt:row.createdAt,updatedAt:row.updatedAt};
  });
  const nativeActive=nativeRuns.filter(active),manual=runs[0];
  if(nativeActive.length>1||nativeActive.length&&active(manual))return Response.json({error:'Conflicting contact research needs review'},{status:409,headers:{'Cache-Control':'no-store'}});
  const native=nativeActive[0]??nativeRuns[0];
  const peopleRun=!manual?native:!native||active(manual)?manual:active(native)?native:new Date(manual.updatedAt??manual.createdAt).getTime()>=native.updatedAt.getTime()?manual:native;
  return Response.json({ ...await loadOutreach(org, id, session.user.id, targetId), peopleRun }, { headers: { "Cache-Control": "no-store" } });
}
