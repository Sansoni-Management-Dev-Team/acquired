import {expect,it} from "vitest";
import {targetedPlan,resolveTargetedChoice,targetedQuery,targetedQueries,nextTargetedAction,shortCompanyName,MAX_TARGETED_SEARCHES} from "./targeted-research";
import type {ResearchConfig,ResearchFinding} from "./research";
const config={purpose:"people",companyName:"Example Instruments",companyDomain:"instruments.example.com",maxPeopleSearches:2} as ResearchConfig;
it("offers only missing-field actions, discovered useful pages and available search allowance",()=>{
 const plan=targetedPlan(config,[],["https://instruments.example.com/team","https://instruments.example.com/products"],[])!;
 expect(plan.actions).toEqual([{id:"read_0",kind:"read",url:"https://instruments.example.com/team"},{id:"search_people",kind:"search",field:"people"},{id:"stop",kind:"stop"}]);
 expect(resolveTargetedChoice({choice:"read_99",url:"https://evil.example.com"},plan).kind).toBe("stop");
 expect(resolveTargetedChoice({choice:"read_0"},plan)).toMatchObject({url:"https://instruments.example.com/team"});
 expect(targetedPlan({...config,maxPeopleSearches:1},[],[],[])).toBeNull();
 expect(targetedPlan(config,[{kind:"person",value:"Director"} as ResearchFinding],[],[])?.actions).toContainEqual({id:"search_email",kind:"search",field:"email"});
 expect(targetedPlan({...config,purpose:"firmographics"},[{kind:"headcount"} as ResearchFinding],[],[])?.actions).toContainEqual({id:"search_revenue",kind:"search",field:"revenue"});
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
it("adds a short trading-name query with industry and location hints",()=>{
 expect(shortCompanyName("Corex Plastics Australia")).toBe("Corex");
 expect(shortCompanyName("Zeus Products Pty Ltd")).toBe("Zeus");
 expect(shortCompanyName("Example Instruments")).toBe("");
 const queries=targetedQueries("size",{purpose:"firmographics",companyName:"Corex Plastics Australia",companyDomain:"corex.example.com",companyLocation:"Dandenong South VIC"} as ResearchConfig);
 expect(queries).toContain('"Corex" plastics Dandenong South VIC employees');
 expect(queries.length).toBeLessThanOrEqual(MAX_TARGETED_SEARCHES.size);
});

it("pivots from the trading name to independent legal-entity and D&B searches", () => {
 const trading = targetedQueries("people", config);
 expect(trading[0]).toBe('"Example Instruments" owner');
 expect(trading).toContain('"Example Instruments" founder');
 expect(trading).toContain('"Example Instruments" ASIC director');
 expect(trading).toContain('"Example Instruments" managing director general manager');
 const legal = targetedQueries("people", {...config, legalEntity: "Example Holdings Pty Ltd (ABN 12 345 678 901)"});
 expect(legal.slice(0, 4)).toEqual([
  '"Example Holdings Pty Ltd" director owner',
  'site:dnb.com "Example Holdings Pty Ltd"',
  '"Example Holdings Pty Ltd" owner shareholder',
  '"Example Holdings Pty Ltd" ASIC director',
 ]);
 expect(legal.filter(query => !trading.includes(query))).toHaveLength(4);
 expect(legal.join(' ')).not.toContain('ABN');
});
it("targets owner email even when a general manager was found first", () => {
 const findings = [{kind:"person",name:"Casey Manager",value:"General Manager"}, {kind:"person",name:"Alex Owner",value:"Owner"}] as ResearchFinding[];
 expect(targetedQueries("email",config,findings)[0]).toContain('"Alex Owner"');
});

it("uses directory names as separate follow-up candidates, without merging nicknames", () => {
 const peopleSearchLeads = [{url:"https://www.zoominfo.com/pic/delphi-measurement-pty-ltd/346253626",title:"Delphi Measurement Employee Directory",snippet:"employees are Michael Leonard, Darren Fraser. Website: delphimeasurement.com",query:"Delphi Measurement owner",observedAt:"2026-09-15",basis:"search-result" as const}];
 const queries=targetedQueries("people",{companyName:"Delphi Measurement",companyDomain:"delphimeasurement.com",peopleSearchLeads});
 expect(queries.slice(0,2)).toEqual(['"Michael Leonard" "Delphi Measurement"','"Darren Fraser" "Delphi Measurement"']);
 expect(queries.join(" ")).not.toContain('"Mike Leonard"');
});
