import { describe, expect, it } from "vitest";
import { peopleRoleConflicts, peopleFollowUpLinks, validatePeopleFindings, orderPeopleQueue } from "./people-research";
import type { ResearchConfig } from "./research";
const config = { companyName: "Example Instruments", companyDomain: "instruments.example.com" } as ResearchConfig;
const source = "https://instruments.example.com/team";
const candidate = { kind: "person", name: "Alex Example", value: "Managing Director", quote: "Alex Example is Managing Director of Example Instruments.", website: source };
describe("public business contact evidence", () => {
  it("requires literal support for both name and role", () => {
    expect(validatePeopleFindings([candidate], candidate.quote, source, config)).toHaveLength(1);
    expect(validatePeopleFindings([{ ...candidate, email: "" }], candidate.quote, source, config)).toHaveLength(1);
    expect(validatePeopleFindings([{ ...candidate, name: "Sam Invented" }], candidate.quote, source, config)).toEqual([]);
    expect(validatePeopleFindings([{ ...candidate, value: "Founder" }], candidate.quote, source, config)).toEqual([]);
    expect(validatePeopleFindings([candidate], "No people here", source, config)).toEqual([]);
  });
  it("requires company association in external profiles", () => {
    const quote = "Alex Example is Managing Director.";
    expect(validatePeopleFindings([{ ...candidate, quote }], quote, "https://directory.example.com/profile", config)).toEqual([]);
    expect(validatePeopleFindings([candidate], candidate.quote, "https://directory.example.com/profile", config)).toHaveLength(1);
  });
  it("does not invent email patterns or attach a general inbox to a person", () => {
    for (const email of ["alex@instruments.example.com", "info@instruments.example.com", "alex@personal.example.com"]) {
      const f = { ...candidate, email };
      expect(validatePeopleFindings([f], f.quote, source, config)[0].email).toBeUndefined();
    }
    const quote = candidate.quote + " Contact Alex Example: alex@instruments.example.com";
    expect(validatePeopleFindings([{ ...candidate, quote, email: "alex@instruments.example.com" }], quote, source, config)[0].email).toBe("alex@instruments.example.com");
    const general = candidate.quote + " General email info@instruments.example.com";
    expect(validatePeopleFindings([{ ...candidate, quote: general, email: "info@instruments.example.com" }], general, source, config)[0].email).toBeUndefined();
  });
  it("follows team and contact links but never login links or already visited pages", () => {
    expect(peopleFollowUpLinks("[Team](/team) [Contact](/contact) [Management login](/login) [Shop](/shop)", source, [source])).toEqual(["https://instruments.example.com/contact"]);
  });
});

it("prioritises team and profile evidence over delivery and legal boilerplate", () => {
  expect(orderPeopleQueue(["https://instruments.example.com/delivery", "https://instruments.example.com/privacy", "https://instruments.example.com/team"], ["https://instruments.example.com/"], config.companyDomain!)[0]).toContain("/team");
});
it("accepts a first-party operator assertion, not an unrelated supplier", () => {
  const quote = 'This site is operated by Example Holdings Pty Ltd.';
  const f = { kind: "identifier", name: "Legal entity", value: "Example Holdings Pty Ltd", quote, website: source };
  expect(validatePeopleFindings([f], quote, source, config)).toHaveLength(1);
  expect(validatePeopleFindings([f], quote, "https://directory.example.com", config)).toEqual([]);
  const other = 'Our supplier is Example Holdings Pty Ltd.';
  expect(validatePeopleFindings([{ ...f, quote: other }], other, source, config)).toEqual([]);
});
it("reads a named profile before generic contact and privacy pages",()=>{
 expect(orderPeopleQueue(['https://instruments.example.com/privacy','https://instruments.example.com/contact','https://www.linkedin.com/in/alexexample'],['https://instruments.example.com/'],config.companyDomain!)[0]).toBe('https://www.linkedin.com/in/alexexample');
});
it("accepts literal names and roles separated by presentation formatting",()=>{
 const markdown='Alex Example is **Managing Director** of Example Instruments.';
 expect(validatePeopleFindings([candidate],markdown,source,config)).toHaveLength(1);
});
it("retains explicit first-party team cards even when the model supplies the wrong quote",()=>{
 const markdown='# Our team\n\n#### Alex Example\n\n##### Managing Director\n\n# Testimonials\n\n#### Sam Sample\n\n##### CEO';
 const wrong={...candidate,quote:'Our team has extensive experience.'};
 const findings=validatePeopleFindings([wrong],markdown,source,config);
 expect(findings).toHaveLength(1);expect(findings[0]).toMatchObject({name:'Alex Example',value:'Managing Director',quote:'#### Alex Example\n\n##### Managing Director'});
 expect(validatePeopleFindings([],markdown,'https://other.example.com/team',config)).toEqual([]);
 expect(validatePeopleFindings([],markdown.replace('# Our team','# Testimonials'),source,config)).toEqual([]);
});
it("reads the company's own team page before third-party profiles",()=>{
 expect(orderPeopleQueue(['https://www.linkedin.com/in/alexexample','https://instruments.example.com/who-we-are/'],['https://instruments.example.com/'],config.companyDomain!)[0]).toContain('/who-we-are/');
});
it("does not follow a directory publisher's own team or country-navigation links",()=>{
 const page='[About the publisher](/about) [Our team](/team) [Choose country](/about/choose-country) [Company team](https://instruments.example.com/team)';
 expect(peopleFollowUpLinks(page,'https://directory.example.com/company/example-instruments',[],config)).toEqual(['https://instruments.example.com/team']);
});
it("rejects role labels and companies masquerading as named people",()=>{
 for(const name of ['Funeral Director','Managing Director','The Founder','Our Team','Example Holdings Pty Ltd']){
  const quote=`Please speak with ${name}, the Managing Director.`;
  expect(validatePeopleFindings([{...candidate,name,quote}],quote,source,config)).toEqual([]);
 }
});
it("reads signed founder messages only inside an explicit first-party founder section", () => {
  const config = { companyName: "Example Instruments", companyDomain: "instruments.example.com" } as ResearchConfig;
  const source = "https://instruments.example.com/";
  const signed = "## About & Message From Founder/Director\nWe founded Example Instruments to make reliable sensors.\n– Alex Example, Founder and Director\n## Customer reviews\n– Casey Customer, Founder";
  expect(validatePeopleFindings([], signed, source, config).map(f => f.name)).toEqual(["Alex Example"]);
  expect(validatePeopleFindings([], signed.replace("About & Message From Founder/Director", "Testimonials"), source, config)).toEqual([]);
  expect(validatePeopleFindings([], signed, "https://directory.example.com/", config)).toEqual([]);
});

it("accepts adjacent team headings without requiring blank lines", () => {
 const page = "# Our team\n#### Alex Example\n##### CEO\n# Testimonials\n#### Casey Customer\n##### CEO";
 expect(validatePeopleFindings([],page,source,config).map(f=>f.name)).toEqual(["Alex Example"]);
});
it("matches visible italic text without changing identifiers or inventing a quote", () => {
 const quote = "We build instruments.” – Alex Example, Managing Director of Example Instruments";
 expect(validatePeopleFindings([{...candidate,quote}],`_“${quote.split(' – ')[0]}_ – Alex Example, Managing Director of Example Instruments`,source,config)).toHaveLength(1);
 expect(validatePeopleFindings([{...candidate,quote:quote.replace('instruments','aircraft')}],`_“${quote}_`,source,config)).toEqual([]);
 const email = "alex_example@instruments.example.com";
 const passage = `${candidate.quote} Contact Alex Example: ${email}`;
 expect(validatePeopleFindings([{...candidate,quote:passage,email}],passage,source,config)[0].email).toBe(email);
});

it("flags competing leadership assertions but not duplicate sources or different roles", () => {
 const ceo = {...candidate,kind:"person" as const,value:"CEO"};
 expect(peopleRoleConflicts([ceo,ceo])).toEqual([]);
 expect(peopleRoleConflicts([ceo,{...ceo,name:"Casey Example",value:"Chief Executive Officer"}])).toEqual(["ceo"]);
 expect(peopleRoleConflicts([ceo,{...ceo,name:"Casey Example",value:"General Manager"}])).toEqual([]);
});

it("reports rejected evidence reasons without returning names or quotes to diagnostics", () => {
  const reasons: string[] = [];
  const config = { companyName: "Example Instruments", companyDomain: "instruments.example.com" } as ResearchConfig;
  validatePeopleFindings([{ kind: "person", name: "Alex Example", value: "CEO", quote: "Alex Example is CEO", website: "https://instruments.example.com", relevance: "unclear" }], "Welcome to our sensor catalogue.", "https://instruments.example.com", config, reason => reasons.push(reason));
  expect(reasons).toEqual(["quote_not_on_page"]);
});
it("captures plain-line team listings with roles and published work emails, never inferring addresses", () => {
  const markdown = "# Meet our team\nOur team members are our strength.\n\n![](https://instruments.example.com/jane.jpg)\nJane Citizen\nManaging Director\n![](https://instruments.example.com/sam.jpg)\nSam Sample\nDirector & National Production Manager\nAlex Example\nGeneral Manager of Operations\n[0400 000 000](tel:0400%20000%20000) alexe@instruments.example.com\nChris Person\nManager - Queensland\n[0400 000 001](tel:0400%20000%20001) chrisp@instruments.example.com\nPat Sampleson\nOwner\npat@personal.example.org\n### Your reliable partner\nContact us today.";
  const findings = validatePeopleFindings([], markdown, source, config);
  expect(findings.map(f => [f.name, f.value, f.email])).toEqual([
    ["Jane Citizen", "Managing Director", undefined],
    ["Sam Sample", "Director & National Production Manager", undefined],
    ["Alex Example", "General Manager of Operations", "alexe@instruments.example.com"],
    ["Chris Person", "Manager - Queensland", "chrisp@instruments.example.com"],
    ["Pat Sampleson", "Owner", undefined],
  ]);
  expect(findings[2].quote).toBe("Alex Example\nGeneral Manager of Operations\n[0400 000 000](tel:0400%20000%20000) alexe@instruments.example.com");
  expect(validatePeopleFindings([], markdown, "https://other.example.com/team", config)).toEqual([]);
  expect(validatePeopleFindings([], markdown.replace("# Meet our team", "# Customer stories"), source, config)).toEqual([]);
});

it("follows only the same D&B company's contacts tab", () => {
 const profile = "https://www.dnb.com/business-directory/company-profiles/example-holdings.123";
 const page = `[Contacts](${profile}/contacts) [Other contacts](https://www.dnb.com/business-directory/company-profiles/other.456/contacts) [Publisher team](https://www.dnb.com/team)`;
 expect(peopleFollowUpLinks(page,profile,[],config)).toEqual([`${profile}/contacts`]);
 expect(peopleFollowUpLinks(page,profile,[`${profile}/contacts`],config)).toEqual([]);
});
it("accepts directory evidence for a verified legal entity without inferring ownership", () => {
 const source = "https://www.dnb.com/business-directory/company-profiles/example-holdings.123/contacts";
 const quote = "# Example Holdings Pty Ltd\nContacts\nAlex Example\nDirector";
 const person = {...candidate, value:"Director", quote, website:source};
 expect(validatePeopleFindings([person],quote,source,{...config,legalEntity:"Example Holdings Pty Ltd"})).toMatchObject([{name:"Alex Example",value:"Director"}]);
 expect(validatePeopleFindings([person],quote,source,config)).toEqual([]);
 expect(validatePeopleFindings([{...person,value:"Owner"}],quote,source,{...config,legalEntity:"Example Holdings Pty Ltd"})).toEqual([]);
});

it("accepts a source-backed Delphi director passage but not the search summary alone", () => {
 // Short excerpt from Cranes & Lifting, 12 September 2025.
 const quote="Mike Leonard, Managing Director at Delphi Measurement";
 const url="https://www.cranesandlifting.com.au/delphi-measurements-australian-made-load-cells-gain-momentum/";
 const company={companyName:"Delphi Measurement",companyDomain:"delphimeasurement.com"} as ResearchConfig;
 const finding={kind:"person",name:"Mike Leonard",value:"Managing Director",quote,website:url};
 expect(validatePeopleFindings([finding],quote,url,company)).toMatchObject([{name:"Mike Leonard",value:"Managing Director"}]);
 expect(validatePeopleFindings([finding],"Subscribe to read the article",url,company)).toEqual([]);
 expect(validatePeopleFindings([{...finding,value:"Owner"}],quote,url,company)).toEqual([]);
 expect(orderPeopleQueue(["https://www.linkedin.com/in/mike-leonard",url],[],company.companyDomain!)[0]).toBe(url);
});
it("retains the visible QA manager card without inventing gated contact details", () => {
 const quote="Key Employees of Delphi Measurement\nDarren Fraser\nManager, Quality Assurance\nPhone Email";
 const url="https://www.zoominfo.com/pic/delphi-measurement-pty-ltd/346253626";
 const findings=validatePeopleFindings([{kind:"person",name:"Darren Fraser",value:"Manager, Quality Assurance",quote,website:url}],quote,url,{companyName:"Delphi Measurement",companyDomain:"delphimeasurement.com"} as ResearchConfig);
 expect(findings).toMatchObject([{name:"Darren Fraser",value:"Manager, Quality Assurance"}]);
 expect(findings[0].email).toBeUndefined();
});

it('rejects Headland customer case-study people despite the first-party host',()=>{
 const cfg={companyName:'Headland Technology',companyDomain:'headland.au'} as ResearchConfig;
 for(const [name,value,quote] of [
 ['Paul Belshaw','General Manager','Paul Belshaw, General Manager, Levett Engineering'],
 ['Paul Nagtzaam','Tool Room Manager','We spoke with Paul Nagtzaam, Tool Room Manager, who has been with Moss Industrial for nearly four decades.'],
 ['Carl Quarterman','Managing Director','Carl Quarterman, Managing Director'],
 ]) expect(validatePeopleFindings([{kind:'person',name,value,quote}],quote,'https://headland.au/customer-stories',cfg)).toEqual([]);
});
it('retains Headland managing-board staff cards but does not guess alternate email-domain ownership',()=>{
 const cfg={companyName:'Headland Technology',companyDomain:'headland.au'} as ResearchConfig;
 const page='# Managing Board\n#### Richard Kloé\n##### Managing Director\nrichard@headland.com.au\n#### Dianne Kloé\n##### Founder and Director\n#### Peter Kloé\n##### Founder and Director';
 expect(validatePeopleFindings([],page,'https://headland.au/managing-board',cfg).map(f=>[f.name,f.email])).toEqual([['Richard Kloé',undefined],['Dianne Kloé',undefined],['Peter Kloé',undefined]]);
});
it('does not use a target company mention to override an explicit foreign employer',()=>{
 const cfg={companyName:'Headland Technology',companyDomain:'headland.au'} as ResearchConfig;
 const quote='Headland Technology interviewed Paul Belshaw, General Manager, Levett Engineering.';
 expect(validatePeopleFindings([{kind:'person',name:'Paul Belshaw',value:'General Manager',quote}],quote,'https://headland.au/case-studies/levett',cfg)).toEqual([]);
});
it('does not treat a target mention elsewhere in a customer quote as employment evidence',()=>{
 const cfg={companyName:'Headland Technology',companyDomain:'headland.au'} as ResearchConfig;
 const quote='Headland Technology supplies our machines. Carl Quarterman, Managing Director, said the service was excellent.';
 expect(validatePeopleFindings([{kind:'person',name:'Carl Quarterman',value:'Managing Director',quote}],quote,'https://headland.au/customer-stories',cfg)).toEqual([]);
});
it('rejects foreign employers across case and Markdown formatting on company and external pages',()=>{
 const cfg={companyName:'Headland Technology',companyDomain:'headland.au'} as ResearchConfig;
 for(const [name,value,quote] of [
 ['Paul Belshaw','General Manager','Headland Technology supplied equipment. Paul Belshaw, general manager of Levett Engineering.'],
 ['Carl Quarterman','Managing Director','Headland Technology supplied equipment. Carl Quarterman, **Managing Director** of **OtherCo**.'],
 ['Paul Belshaw','General Manager','Paul Belshaw, General Manager of Levett Engineering, discussed equipment from Headland Technology.'],
 ]) for(const url of ['https://headland.au/customer-stories','https://manufacturing.example.org/headland']) expect(validatePeopleFindings([{kind:'person',name,value,quote}],quote,url,cfg)).toEqual([]);
});
it('accepts an explicit target employment relationship despite role case and Markdown formatting',()=>{
 const quote='Richard Kloé is **managing director** of **Headland Technology**.';
 expect(validatePeopleFindings([{kind:'person',name:'Richard Kloé',value:'Managing Director',quote}],quote,'https://headland.au/about',{companyName:'Headland Technology',companyDomain:'headland.au'} as ResearchConfig)).toHaveLength(1);
});
