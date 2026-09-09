import {expect,it} from "vitest";
import {targetedPlan,resolveTargetedChoice,targetedQuery} from "./targeted-research";
import type {ResearchConfig,ResearchFinding} from "./research";
const config={purpose:"people",companyName:"Example Instruments",companyDomain:"instruments.example.com",maxPeopleSearches:2} as ResearchConfig;
it("offers only missing-field actions, discovered useful pages and available search allowance",()=>{
 const plan=targetedPlan(config,[],["https://instruments.example.com/team","https://instruments.example.com/products"],[])!;
 expect(plan.actions).toEqual([{id:"read_0",kind:"read",url:"https://instruments.example.com/team"},{id:"search_people",kind:"search",field:"people"},{id:"stop",kind:"stop"}]);
 expect(resolveTargetedChoice({choice:"read_99",url:"https://evil.example.com"},plan).kind).toBe("stop");
 expect(resolveTargetedChoice({choice:"read_0"},plan)).toMatchObject({url:"https://instruments.example.com/team"});
 expect(targetedPlan({...config,maxPeopleSearches:1},[],[],[])).toBeNull();
 expect(targetedPlan(config,[{kind:"person"} as ResearchFinding],[],[])).toBeNull();
 expect(targetedPlan({...config,purpose:"firmographics"},[{kind:"headcount"} as ResearchFinding],[],[])).toBeNull();
});
it("anchors queries in company identity and only uses supplied legal operators",()=>{
 expect(targetedQuery("size",config)).toBe('"instruments.example.com" employees');
 expect(targetedQuery("people",config)).toContain('"instruments.example.com"');
 expect(targetedQuery("people",{...config,legalEntity:"Example Holdings Pty Ltd"})).toBe('"Example Holdings Pty Ltd" director owner');
});
