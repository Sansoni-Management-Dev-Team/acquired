import { expect, it } from 'vitest';
import { fixtureHtml, fixtureCompletion } from './fixture-server.mjs';
import { observedCompanyFacts } from '../../src/domain/company-facts';
import { observedCompanyIdentifiers } from '../../src/domain/company-identifiers';
import { peopleExtractionSchema, validatePeopleFindings } from '../../src/domain/people-research';
import { businessPrompt, headingCompanyFinding, validateBusinessFindings } from '../../src/domain/business-research';
import { researchExtractionSchema } from '../../src/domain/research-extraction-schema';
import type { ResearchConfig } from '../../src/domain/research';
it('provides grounded first-party size, revenue and validated ABN for deterministic field branches', () => {
 for (const slug of ['alpha', 'beta', 'gamma']) {
  const url = `https://${slug}.instruments.example.com/`;
  const config = { companyName: `${slug[0].toUpperCase()}${slug.slice(1)} Instruments`, companyDomain: `${slug}.instruments.example.com` } as ResearchConfig;
  const page = fixtureHtml(slug);
  expect(observedCompanyFacts(page, url, config).map(finding => finding.kind)).toEqual(expect.arrayContaining(['headcount', 'revenue']));
  expect(observedCompanyIdentifiers(page, url, config)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'identifier', name: 'ABN' })]));
 }
});

it('fixture extraction provides a supported decision maker with published email for every company', () => {
 for (const slug of ['alpha', 'beta', 'gamma']) {
  const url = `https://${slug}.instruments.example.com/`;
  const config = { companyName: `${slug[0].toUpperCase()}${slug.slice(1)} Instruments`, companyDomain: `${slug}.instruments.example.com` } as ResearchConfig;
  const page = fixtureHtml(slug);
  const result = fixtureCompletion({ messages: [{ content: `${url}\n${page}` }], response_format: { json_schema: peopleExtractionSchema } });
  const findings = JSON.parse(result.choices[0].message.content).findings;
  expect(validatePeopleFindings(findings, page, url, config)).toEqual(expect.arrayContaining([expect.objectContaining({kind:'person',email:`${slug}@${slug}.instruments.example.com`})]));
 }
});

it('honors requested people extraction on a company website with grounded claims within the four finding limit', () => {
 const slug='alpha', url=`https://${slug}.instruments.example.com/`;
 const config={companyName:'Alpha Instruments',companyDomain:'alpha.instruments.example.com',searchTerms:['industrial sensors'],findPeople:true} as ResearchConfig;
 const page=fixtureHtml(slug);
 const result=fixtureCompletion({messages:businessPrompt(page,config.searchTerms,url,true,config),response_format:{json_schema:researchExtractionSchema}});
 const findings=JSON.parse(result.choices[0].message.content).findings;
 expect(findings.length).toBeLessThanOrEqual(4);
 expect(validateBusinessFindings(findings,page,url,config)).toEqual(expect.arrayContaining([expect.objectContaining({kind:'person',name:'Alex Taylor',email:'alpha@alpha.instruments.example.com'})]));
});

it('records company identity with the same grounded heading as the deterministic parser', () => {
 for(const slug of ['alpha','beta','gamma']) {
  const name=`${slug[0].toUpperCase()}${slug.slice(1)} Instruments`,url=`https://${slug}.instruments.example.com/`;
  const page=`# ${name}\n\n${name} designs and manufactures precision industrial sensors in Victoria, Australia.\nWe manufacture industrial sensors and precision instrumentation for Australian manufacturing customers.`;
  const config={companyName:name,companyDomain:`${slug}.instruments.example.com`,searchTerms:['industrial sensors']} as ResearchConfig;
  const response=fixtureCompletion({messages:businessPrompt(page,config.searchTerms,url,false,config),response_format:{json_schema:researchExtractionSchema}});
  const findings=validateBusinessFindings(JSON.parse(response.choices[0].message.content).findings,page,url,config);
  expect(findings.find(finding=>finding.kind==='company')).toMatchObject({name,value:name,quote:headingCompanyFinding(page,url)?.quote || `# ${name}`});
 }
});
