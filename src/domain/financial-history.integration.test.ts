import {expect,it} from 'vitest';
import {Pool} from 'pg';
import {writeFileSync} from 'node:fs';
import {targetRecordToRankedTarget} from '@/db/target-record-mapper';
import {resolveTargetRevenue,resolveTargetEbitda,financialInterval} from '@/domain/target-financial-evidence';
import {companyScopedFacts} from '@/domain/company-scoped-facts';
const ids=['e7b2cf86-8333-4051-872a-7b871fd217ef','fac91964-2826-4090-b306-bd926a031771','b8e35133-faf2-4505-a359-44533ba6df9a','a9fb0c38-b87c-493e-9fbb-07a0227d4f50'];
it.skipIf(!process.env.FINANCIAL_HISTORY_DATABASE_URL)('replays retained historical targets without any database mutation',async()=>{
 const pool=new Pool({connectionString:process.env.FINANCIAL_HISTORY_DATABASE_URL,max:1});const reports=[];
 try {const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await c.query("SET LOCAL statement_timeout='15s'");
 for(const id of ids){const rows=(await c.query('SELECT t.* FROM targets t JOIN mandate_targets mt ON mt.target_id=t.id AND mt.organization_id=t.organization_id WHERE mt.mandate_id=$1',[id])).rows;
 const summary={mandate:id,companies:rows.length,retainedCompanyBands:0,primaryRevenue:0,audPrimaryRevenue:0,auOnlyRevenue:0,revenueEbitda:0,headcountFallback:0,reportedEbitda:0,unavailable:0,review:0};
 for(const row of rows){const stored=JSON.stringify(row);const converted=Object.fromEntries(Object.entries(row).map(([key,value])=>[key.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase()),value]));const target=targetRecordToRankedTarget(converted as Parameters<typeof targetRecordToRankedTarget>[0],[]);
 const revenue=resolveTargetRevenue(target);const au=resolveTargetRevenue(target,'AU');const model=resolveTargetEbitda([],target.headcount.value??undefined,target);const facts=target.sourceData?.firmable?.rawResponse?companyScopedFacts(target.sourceData.firmable.rawResponse):undefined;
 if(facts?.revenue.global.value)summary.retainedCompanyBands++;
 if(revenue.value!==null)summary.primaryRevenue++;
 if(financialInterval(revenue.value,revenue.provenance.currency))summary.audPrimaryRevenue++;
 if(au.value!==null)summary.auOnlyRevenue++;
 if(model.modelBasis==='revenue')summary.revenueEbitda++;else if(model.modelBasis==='reported')summary.reportedEbitda++;else if(model.status==='estimated')summary.headcountFallback++;else summary.unavailable++;
 if(model.match?.needsReview)summary.review++;
 if(model.status==='estimated'){expect(Number.isFinite(model.low)).toBe(true);expect(Number.isFinite(model.high)).toBe(true);expect(model.low!).toBeLessThanOrEqual(model.high!);}
 expect(JSON.stringify(row)).toBe(stored);expect(target.sourceData?.firmable?.rawResponse).toEqual((row.firmographics?.firmable || row.firmographics?.websiteProfile)?.rawResponse);
 if(facts?.revenue.global.value)expect(revenue.value).not.toBeNull();
 }
 if(id===ids[0]){expect(summary.companies).toBe(100);expect(summary.retainedCompanyBands).toBe(85);expect(summary.primaryRevenue).toBeGreaterThanOrEqual(85);expect(summary.auOnlyRevenue).toBe(23);expect(summary.revenueEbitda).toBeGreaterThanOrEqual(82);}
 reports.push(summary);
 }
 }finally{await c.query('ROLLBACK');c.release();}}finally{await pool.end();}
 if(process.env.FINANCIAL_HISTORY_REPORT)writeFileSync(process.env.FINANCIAL_HISTORY_REPORT,JSON.stringify({retrievedAt:new Date().toISOString(),readOnly:true,reports},null,2));console.log(JSON.stringify(reports));
},90000);
