import { describe, expect, it } from "vitest";
import { businessPrompt, businessResearchStatus, eligibleForPeople, ownCompany, validateBusinessFindings } from "./business-research";
import { researchStartSchema, type ResearchConfig, type ResearchFinding } from "./research";
const url = "https://instruments.example.com/";
const company: ResearchFinding = {kind:"company", name:"Example Instruments", value:"precision sensors", quote:"Example Instruments makes precision sensors.", website:url, relevance:"relevant"};
const product: ResearchFinding = {kind:"product", name:"Sensors", value:"precision sensors", quote:company.quote, website:url, relevance:"relevant"};
const person: ResearchFinding = {kind:"person", name:"Alex Example", value:"Managing Director", quote:"Alex Example is Managing Director. Email alex@instruments.example.com", website:url, email:"alex@instruments.example.com", relevance:"unclear"};
const page = `${company.quote}\n${person.quote}`;
const config: ResearchConfig = {workflow:"business",findPeople:true,peopleBudget:{maxCompanies:2,maxPages:2},seeds:[url],searchTerms:["precision sensors"],geography:"Australia",approved:true,discover:true,budget:{maxPages:3,maxDomains:3,maxModelCalls:3,maxMinutes:10}};
describe("combined business research", () => {
  it("captures a source-listed decision maker with business evidence in the same extraction", () => {
    const result = validateBusinessFindings([company,product,person],page,url,config);
    expect(result.map(f=>f.kind)).toEqual(["company","product","person"]);
    expect(result[2].email).toBe(person.email);
    expect(businessPrompt(page,config.searchTerms,url,true)[0].content).toContain('kind "person"');
  });
  it("does not capture people when disabled or on a third-party company listing", () => {
    expect(validateBusinessFindings([company,person],page,url,{...config,findPeople:false}).some(f=>f.kind==="person")).toBe(false);
    expect(ownCompany([company],"https://directory.example.com/")).toBeUndefined();
    expect(validateBusinessFindings([company,person],`${page} [Company](${url})`,"https://directory.example.com/",config).some(f=>f.kind==="person")).toBe(false);
  });
  it("rejects invented roles and strips unsupported email", () => {
    expect(validateBusinessFindings([company,{...person,value:"Founder"}],page,url,config)).toHaveLength(1);
    const result = validateBusinessFindings([company,{...person,email:"guessed@instruments.example.com"}],page,url,config);
    expect(result.find(f=>f.kind==="person")?.email).toBeUndefined();
  });
  it("requires explicit bounded people allowance", () => {
    const request = {...config,requestId:"00000000-0000-4000-8000-000000000001"};
    expect(researchStartSchema.safeParse(request).success).toBe(true);
    expect(researchStartSchema.safeParse({...request,peopleBudget:undefined}).success).toBe(false);
    expect(researchStartSchema.safeParse({...request,peopleBudget:{maxCompanies:250,maxPages:100}}).success).toBe(true);
    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(researchStartSchema.safeParse({...request,peopleBudget:{maxCompanies:invalid,maxPages:2}}).success).toBe(false);
      expect(researchStartSchema.safeParse({...request,peopleBudget:{maxCompanies:2,maxPages:invalid}}).success).toBe(false);
    }
    expect(researchStartSchema.safeParse({...request,budget:{...config.budget,maxModelCalls:0}}).success).toBe(false);
  });
  it("only spends deeper people budget after relevance and identity are supported", () => {
    expect(eligibleForPeople("instruments.example.com","identified",[company,product])).toBe(true);
    expect(eligibleForPeople("instruments.example.com","identified",[company])).toBe(false);
    expect(eligibleForPeople("unrelated.example.com","identified",[company,product])).toBe(false);
    expect(eligibleForPeople("instruments.example.com","excluded",[company,product])).toBe(false);
    expect(eligibleForPeople("instruments.example.com","identified",[company,product,person])).toBe(false);
  });
  it("missing contacts do not block review and weak evidence remains unresolved", () => {
    expect(businessResearchStatus("instruments.example.com",[company,product],true)).toBe("Ready to review");
    expect(businessResearchStatus("instruments.example.com",[company],true)).toBe("Researching");
    expect(businessResearchStatus("instruments.example.com",[company],false)).toBe("Needs more evidence");
  });
});
