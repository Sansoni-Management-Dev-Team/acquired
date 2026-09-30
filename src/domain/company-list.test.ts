import { expect, it } from 'vitest';
import { companyListPage, defaultCompanyListQuery, summariseCompany, type CompanySummary } from './company-list';
import { emptyBrief, initialAssessment } from './acquisition';
import { rankTarget } from './scoring';
import { seedTargets, defaultMandate } from '@/test/fixtures/scoring-targets';
it('summarises table requirements without exposing execution state or raw company evidence', () => {
  const target = rankTarget(seedTargets[0],defaultMandate);
  const mandate = { id: 'mandate', brief: emptyBrief(), createdAt: '2026-09-30' };
  const row = summariseCompany({ target, assessment: initialAssessment, version: 1, accreditations: [] },mandate,[{status:'reading',targetId:target.id,seeds:[]}],true);
  expect(row.researchStatus).toBe('Researching');expect(row.hasPerson).toBe(true);expect(row.fit).toHaveProperty('reason');
  expect(row).not.toHaveProperty('config');expect(row).not.toHaveProperty('researchFindings');expect(row).not.toHaveProperty('target');
});
const makeRow = (id: number): CompanySummary => ({id:String(id),name:`Company ${id}`,domain:'example.com',sector:'manufacturing',stage:'identified',accreditations:['ISO quality'],researchStatus:'Needs more evidence',hasHeadcount:false,hasRevenue:false,hasPerson:false,fit:{score:0,assessed:false,provisional:false,completeness:0,rows:[],reason:'Review criteria'}});
it('filters across all rows before pagination and ranks available data first', () => {
  const rows = Array.from({length:60},(_,i)=>makeRow(i));rows[59].hasPerson=true;
  const first=companyListPage(rows,defaultCompanyListQuery);
  expect(first.total).toBe(60);expect(first.rows).toHaveLength(25);expect(first.rows[0].id).toBe('59');
  expect(companyListPage(rows,{...defaultCompanyListQuery,data:'person'}).rows.map(r=>r.id)).toEqual(['59']);
  expect(companyListPage(rows,{...defaultCompanyListQuery,search:'company 59'}).total).toBe(1);
  expect(companyListPage(rows,{...defaultCompanyListQuery,accreditation:'nonexistent'}).total).toBe(0);
  expect(companyListPage(rows,{...defaultCompanyListQuery,page:10}).page).toBe(3);
});
it('orders by highest fit across all pages, using available data to break ties', () => {
  const rows = Array.from({length:60},(_,i)=>makeRow(i));
  rows[0].hasPerson=true; rows[1].fit.score=50; rows[58].fit.score=50; rows[58].hasRevenue=true; rows[59].fit.score=100;
  const first=companyListPage(rows,defaultCompanyListQuery);
  expect(first.rows.slice(0,4).map(row=>row.id)).toEqual(['59','58','1','0']);
  expect(companyListPage(rows,{...defaultCompanyListQuery,page:2}).rows.every(row=>row.fit.score===0)).toBe(true);
});
