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
 const quote = "We build instruments.” – Alex Example, Managing Director";
 expect(validatePeopleFindings([{...candidate,quote}],`_“${quote.split(' – ')[0]}_ – Alex Example, Managing Director`,source,config)).toHaveLength(1);
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
    ["Pat Sampleson", "Owner", undefined],
  ]);
  expect(findings[2].quote).toBe("Alex Example\nGeneral Manager of Operations\n[0400 000 000](tel:0400%20000%20000) alexe@instruments.example.com");
  expect(validatePeopleFindings([], markdown, "https://other.example.com/team", config)).toEqual([]);
  expect(validatePeopleFindings([], markdown.replace("# Meet our team", "# Customer stories"), source, config)).toEqual([]);
});
