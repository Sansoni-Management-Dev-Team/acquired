import {Suspense} from 'react';
import Link from 'next/link';
import {notFound} from 'next/navigation';
import {z} from 'zod';
import {AcquisitionRepository} from '@/db/acquisition-repository';
import {CompanyListRepository} from '@/db/company-list-repository';
import {defaultCompanyListQuery} from '@/domain/company-list';
import {acquisitionSession} from '@/lib/acquisition-session';
import {durableAgentEnabled} from '@/lib/agent-runtime';
import {MandateWorkspace} from '@/components/mandate-workspace';
import {PageLoading} from '@/components/page-loading';

export default async function CompaniesPage({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  if(!z.string().uuid().safeParse(id).success)notFound();
  return <Suspense fallback={<PageLoading />}><CompaniesContent id={id} /></Suspense>;
}

async function CompaniesContent({id}:{id:string}) {
  const {organizationId}=await acquisitionSession();
  const mandates=await new AcquisitionRepository(organizationId).listMandates();
  const mandate=mandates.find(item=>item.id===id);
  if(!mandate)notFound();
  const companies=await new CompanyListRepository(organizationId).load(id,defaultCompanyListQuery);
  if(!companies||'unchanged' in companies)notFound();
  const initial={mandate,memberships:[],coverage:[],valuations:[],buyerProfile:null,contacts:[],firmableRefreshes:[]};
  return <>
    {process.env.AGENT_MODE_EXPLORATION_ENABLED==='true'&&<div className="px-5 pt-4 sm:px-8"><Link href={`/mandates/${id}/agent`} className="text-sm text-[var(--muted)] underline underline-offset-4">Open agent workspace · research preview →</Link></div>}
    <MandateWorkspace key={`${id}:targets`} learningEnabled={process.env.AGENT_GUIDANCE_ENABLED==='true'&&process.env.AGENT_MODE_EXPLORATION_ENABLED==='true'&&durableAgentEnabled()} mandates={mandates} initial={initial} initialCompanies={companies} tab="targets" />
  </>;
}
