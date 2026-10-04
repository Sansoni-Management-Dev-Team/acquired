import {effectiveRevenueRange} from "@/domain/target-financial-evidence";
import type { Mandate,TargetCandidate } from '@/domain/models';
import type { TargetSource,TargetSourceCapabilities } from './target-source';
import {FirmableClient} from './firmable-client';
import {deduplicateFirmableRows} from '@/domain/firmable-company-pipeline';
import {mapFirmableProfile} from './firmable-company-mapper';
export class FirmableTargetSource implements TargetSource {
 readonly name='Firmable';
 constructor(private client=new FirmableClient(),private organisationId='',private mandate:Mandate={sectors:[],states:[],revenue:{min:0,max:null},ebitda:{min:0,max:null}}){}
 async search(mandate:Mandate):Promise<TargetCandidate[]>{
  const page=await this.client.searchCompaniesPage(JSON.stringify({ ...mandate, revenue: effectiveRevenueRange(mandate) }));
  const rows=deduplicateFirmableRows(page.records),targets:TargetCandidate[]=[];
  // The session coordinator owns pacing; bound application fanout below its queue limit.
  for(let i=0;i<rows.length;i+=2)targets.push(...await Promise.all(rows.slice(i,i+2).map(async row=>mapFirmableProfile(await this.client.enrichCompany({id:String(row.id)}),mandate,this.organisationId))));
  return targets;
 }
 async enrich(identifier:string){return mapFirmableProfile(await this.client.enrichCompany(/^f\d+$/.test(identifier)?{id:identifier}:{fqdn:identifier}),this.mandate,this.organisationId);}
 capabilities():TargetSourceCapabilities{return {canSearch:process.env.FIRMABLE_TRANSPORT==='cloudflare-session'&&this.client.isConfigured(),canEnrich:this.client.isConfigured(),coverage:'Company-only session search and profiles; mandate screening required'};}
}
