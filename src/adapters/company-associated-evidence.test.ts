import {expect,it,vi} from 'vitest';
import {registryAssociation,explicitRelatedDomains,publishedCompanyAddresses} from './company-association-evidence';
import {publishedTeamMembers} from './company-team-evidence';
import {parsePublishedAccreditation} from './accreditation-register';
import {createCompanyMissingFieldResearch,registryNameSearchQuery} from './company-missing-field-research';
const source='https://nata.com.au/accredited-organisation/orion-laboratory-100-200/';
const identity={name:'Orion Laboratory Pty Ltd',domain:'orion.example.com',addresses:['4 Apollo Road Perth WA 6000']};
const listing='<h2>Orion Laboratory</h2><p>Accreditation No. 100 Site No. 200</p><p>4 Apollo Rd Perth WA 6000</p><a href="https://allied.example.com">Website</a><p>Contact Ms Ava Nguyen P: +61 0400 100 200</p><h2>Scope of Accreditation</h2><p>ISO/IEC 17025</p><a href="https://sponsor.example.com">Sponsor</a>';
it('official registry association requires identity plus independent address and excludes footer links',()=>{
 expect(registryAssociation(listing,source,identity)).toEqual([expect.objectContaining({domain:'allied.example.com',corroboration:'address'})]);
 expect(registryAssociation(listing,source,{...identity,addresses:['99 Other Road Perth WA 6000']})).toEqual([]);
 expect(registryAssociation(listing,source,{...identity,name:'Other Laboratory'})).toEqual([]);
});
it('phone/email corroboration generalizes while name alone cannot associate domains',()=>{
 const page=listing.replace('4 Apollo Rd Perth WA 6000','Email: info@orion.example.com');
 expect(registryAssociation(page,source,{name:identity.name,domain:identity.domain,phones:['0400100200']})).toEqual([expect.objectContaining({corroboration:'phone'})]);
 expect(registryAssociation(page,source,{name:identity.name,domain:identity.domain,emails:['info@orion.example.com']})).toEqual([expect.objectContaining({corroboration:'email'})]);
 expect(registryAssociation(page,source,{name:identity.name,domain:identity.domain})).toEqual([]);
});
it('explicit first-party relationship is evidence; links and testimonial names alone are not',()=>{
 expect(explicitRelatedDomains('<p>Our business is now part of <a href="https://allied.example.com">Allied</a></p>','https://orion.example.com/',identity)).toHaveLength(1);
 expect(explicitRelatedDomains('<p>Our partners <a href="https://allied.example.com">Allied</a></p>','https://orion.example.com/',identity)).toEqual([]);
 expect(explicitRelatedDomains('<p>Our business is now part of <a href="https://allied.example.com">Allied</a></p>','https://stranger.example.com/',identity)).toEqual([]);
});
it('team headings and varied published roles retain source and do not attach next member contacts',()=>{
 const html='<h2>Our Team</h2><h3>Rita Chen</h3><p>Senior Chemist</p><h3>Omar Patel</h3><p>Laboratory Technician</p><p>omar@orion.example.com</p><h2>Testimonials</h2><p>Alice Evans</p><p>Managing Director</p>';
 const members=publishedTeamMembers(html,'','https://orion.example.com/team','2026-10-08','fixture');
 expect(members).toHaveLength(2);expect(members[0]).toMatchObject({name:'Rita Chen',role:'Senior Chemist',employmentStatus:'published_team_member'});expect(members[0].email).toBeUndefined();expect(members[1].email).toBe('omar@orion.example.com');
 expect(publishedTeamMembers('<h2>Testimonials</h2><p>Alice Evans</p><p>CEO</p>','','https://orion.example.com/', 'now','fixture')).toEqual([]);
});
it('bounded registry/name fallback discovers corroborated domain, staff and metadata from read pages',async()=>{
 const search=vi.fn(async(query:string)=>query.includes('"Orion Laboratory"')?[{url:source}]:[]);
 const readPage=vi.fn(async(url:string)=>({url,reader:'fixture',html:url===source?listing:url.includes('allied.example.com')?'<h1>Our Team</h1><h3>Rita Chen</h3><p>Senior Chemist</p>':'<p>4 Apollo Road Perth WA 6000</p>'}));
 const result=await createCompanyMissingFieldResearch({readPage,search})({name:identity.name,website:'https://orion.example.com/',missingFields:['accreditations','team_members','accreditation_contacts']});
 expect(search.mock.calls.length).toBeLessThanOrEqual(4);expect(result.relatedDomains).toContainEqual(expect.objectContaining({domain:'allied.example.com'}));expect(result.teamMembers?.[0].role).toBe('Senior Chemist');expect(result.accreditations?.[0]).toMatchObject({accreditationNumber:'100',siteNumber:'200',standard:'ISO/IEC 17025'});expect(result.registryContacts[0].role).toBe('Accreditation contact');
 expect(result.facts.find(f=>f.field==='team_members')?.association?.domain).toBe('allied.example.com');
});
it('unrelated registry listing never enables other-domain staff retrieval',async()=>{
 const readPage=vi.fn(async(url:string)=>({url,reader:'fixture',html:url===source?listing:'<p>99 Other Road Perth WA 6000</p>'}));
 const result=await createCompanyMissingFieldResearch({readPage})({name:identity.name,website:'https://orion.example.com/',knownRegistryUrls:[source],missingFields:['team_members','accreditations']});
 expect(result.relatedDomains).toEqual([]);expect(result.teamMembers).toEqual([]);expect(result.accreditations).toEqual([]);expect(readPage.mock.calls.some(c=>c[0].includes('allied'))).toBe(false);
});

it('compact official-registry address formatting retains independent physical-address proof',()=>{expect(registryAssociation(listing.replace('4 Apollo Rd Perth WA 6000','4 Apollo RoadPerth, WA 6000Australia'),source,identity)).toContainEqual(expect.objectContaining({corroboration:'address'}));});

it('explicit named staff emails remain person channels and generic inbox remains company channel',async()=>{const result=await createCompanyMissingFieldResearch({readPage:async url=>({url,reader:'fixture',html:'<h2>Our Team</h2><h3>Rita Chen</h3><p>Senior Chemist</p><p><a href="mailto:rita@orion.example.com">rita@orion.example.com</a></p><h2>Contact</h2><p>office@orion.example.com</p>'})})({name:identity.name,website:'https://orion.example.com/',missingFields:['company_emails','team_members']});expect(result.teamMembers?.[0].email).toBe('rita@orion.example.com');expect(result.facts.filter(f=>f.field==='company_emails').map(f=>f.value)).toEqual(['office@orion.example.com']);});

it('accreditation date is a validated separate calendar fact, never founded year',()=>{const html=listing.replace('Site No. 200','Site No. 200 Date of Accreditation 07 Nov 1984');expect(parsePublishedAccreditation(html,source,identity.domain,'now',identity)?.accreditationDate).toBe('1984-11-07');expect(parsePublishedAccreditation(html.replace('07 Nov 1984','31 Feb 1984'),source,identity.domain,'now',identity)?.accreditationDate).toBeUndefined();});
it('transient reads retry once within page and deadline caps with both attempts retained',async()=>{let reads=0;const result=await createCompanyMissingFieldResearch({readPage:async url=>{if(++reads===1)throw Error('temporary');return{url,reader:'fixture',html:'office@orion.example.com'};}})({name:identity.name,website:'https://orion.example.com/',missingFields:['company_emails']});expect(reads).toBe(2);expect(result.fields.company_emails?.status).toBe('reported');expect(result.attempts.map(a=>a.status)).toEqual(['failed','succeeded']);let blockedReads=0;await createCompanyMissingFieldResearch({readPage:async()=>{blockedReads++;throw Error('temporary');}})({name:identity.name,website:'https://orion.example.com/',missingFields:['company_emails'],maxPages:1});expect(blockedReads).toBe(1);let clock=0,expiredReads=0;await createCompanyMissingFieldResearch({now:()=>clock,readPage:async()=>{expiredReads++;clock=110001;throw Error('temporary');}})({name:identity.name,website:'https://orion.example.com/',missingFields:['company_emails'],deadline:110000});expect(expiredReads).toBe(1);});
it('assets and failing navigation cannot consume the reserved registry/name search reads',async()=>{
 const search=vi.fn(async(query:string)=>query.includes('"Orion Laboratory"')?[{url:source}]:[]);
 const readPage=vi.fn(async(url:string)=>{if(url==='https://orion.example.com/')return{url,reader:'fixture',html:'<p>4 Apollo Road Perth WA 6000</p><link href="/contact-form7/styles.css"/><a href="/contact">Contact</a><a href="/about">About</a><a href="/terms">Terms</a><a href="/contact-form.js">Asset</a>'};if(url===source)return{url,reader:'fixture',html:listing};throw Error('missing page');});
 const result=await createCompanyMissingFieldResearch({readPage,readDocument:async()=>{throw Error('missing discovery');},search})({name:identity.name,website:'https://orion.example.com/',missingFields:['accreditation_contacts','accreditations','team_members']});
 expect(readPage.mock.calls.length).toBeLessThanOrEqual(8);expect(readPage.mock.calls.some(c=>/\.css|\.js/.test(c[0]))).toBe(false);expect(search.mock.calls.some(c=>c[0].includes('"Orion Laboratory"'))).toBe(true);expect(result.registryContacts[0].role).toBe('Accreditation contact');expect(result.accreditations?.[0].accreditationNumber).toBe('100');
});
it('known official registry URLs are read before ordinary discovered navigation',async()=>{
 const readPage=vi.fn(async(url:string)=>({url,reader:'fixture',html:url===source?listing:'<p>4 Apollo Road Perth WA 6000</p><a href="/contact">Contact</a><a href="/about">About</a>'}));
 await createCompanyMissingFieldResearch({readPage})({name:identity.name,website:'https://orion.example.com/',knownRegistryUrls:[source],missingFields:['accreditation_contacts']});expect(readPage.mock.calls[1][0]).toBe(source);
});

it('registry fallback strips legal suffixes and uses location rather than overconstraining full street',()=>{expect(registryNameSearchQuery({name:'Nova Analytics Pty. Ltd.',website:'https://nova.example.com/'},['99 Quasar Road Sydney NSW 2000'])).toBe('site:nata.com.au/accredited-organisation/ "Nova Analytics" NSW 2000');expect(registryNameSearchQuery({name:'Pacific Scientific Limited',website:'https://pacific.example.com/'})).toBe('site:nata.com.au/accredited-organisation/ "Pacific Scientific"');});
it('failed primary admission still permits bounded registry fallback with reproducible query/result audit',async()=>{const search=vi.fn(async(query:string)=>{if(query.includes('"orion.example.com"'))throw Error('browser admission');return[{url:source}];});const result=await createCompanyMissingFieldResearch({search,readPage:async url=>({url,reader:'fixture',html:url===source?listing:'<p>4 Apollo Road Perth WA 6000</p>'})})({name:identity.name,website:'https://orion.example.com/',missingFields:['accreditation_contacts'],deadline:Date.now()+95000});expect(search).toHaveBeenCalledTimes(2);expect(result.registryContacts[0].name).toBe('Ava Nguyen');expect(result.attempts.filter(a=>a.kind==='search')).toEqual([expect.objectContaining({status:'failed',query:'site:nata.com.au/accredited-organisation/ "orion.example.com" accreditation contact'}),expect.objectContaining({status:'succeeded',query:'site:nata.com.au/accredited-organisation/ "Orion Laboratory" WA 6000',resultCount:1})]);});

it('physical address extraction stops at its first postcode instead of appending a neighbouring postal address',()=>{const addresses=publishedCompanyAddresses('4 Apollo Road, Perth WA 6000 Postal Address: PO Box 591, Perth WA 6000');expect(addresses).toEqual(['4 Apollo Road, Perth WA 6000']);expect(registryAssociation(listing,source,{...identity,addresses})).toContainEqual(expect.objectContaining({domain:'allied.example.com',corroboration:'address'}));expect(registryAssociation(listing,source,{...identity,addresses:['4 Apollo Road Perth WA 6001']})).toEqual([]);});
