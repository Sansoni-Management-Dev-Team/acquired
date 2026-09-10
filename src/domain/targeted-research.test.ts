import {expect,it} from "vitest";
import {targetedPlan,resolveTargetedChoice,targetedQuery,targetedQueries,nextTargetedAction,MAX_TARGETED_SEARCHES} from "./targeted-research";
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
it("offers a bounded, non-repeating search ladder and inspects surfaced pages before searching again",()=>{
 const size={purpose:"firmographics",companyName:"Example Instruments",companyDomain:"instruments.example.com"} as ResearchConfig;
 const queries=targetedQueries("size",size);
 expect(queries[0]).toBe('"instruments.example.com" employees');
 expect(queries).toContain('"Example Instruments" employees');
 expect(new Set(queries).size).toBe(queries.length);
 expect(queries.length).toBeLessThanOrEqual(MAX_TARGETED_SEARCHES.size);
 expect(targetedQueries("people",{...size,legalEntity:"Example Holdings Pty Ltd"}).length).toBeLessThanOrEqual(MAX_TARGETED_SEARCHES.people);
 const plan=targetedPlan(size,[],["https://instruments.example.com/about","https://www.datanyze.com/companies/example-instruments/1"],[])!;
 expect(nextTargetedAction(plan,{readsSinceSearch:0,searchAvailable:true})).toMatchObject({kind:"read",url:"https://www.datanyze.com/companies/example-instruments/1"});
 const own=targetedPlan(size,[],["https://instruments.example.com/team"],[])!;
 expect(nextTargetedAction(own,{readsSinceSearch:0,searchAvailable:true})).toMatchObject({kind:"read"});
 expect(nextTargetedAction(own,{readsSinceSearch:1,searchAvailable:true})).toMatchObject({kind:"search",field:"size"});
 expect(nextTargetedAction(own,{readsSinceSearch:1,searchAvailable:false})).toMatchObject({kind:"read"});
 // Generic about/values pages are not worth a follow-up read while searches remain.
 expect(nextTargetedAction(targetedPlan(size,[],["https://instruments.example.com/about/values"],[])!,{readsSinceSearch:0,searchAvailable:true})).toMatchObject({kind:"search"});
 expect(targetedPlan(size,[],[],[],false)).toBeNull();
});
