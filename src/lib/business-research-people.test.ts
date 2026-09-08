import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(()=>({get:vi.fn(),create:vi.fn(),members:vi.fn(),where:vi.fn(),worker:vi.fn()}));
vi.mock("@/db/client",()=>({requireDb:()=>({select:()=>({from:()=>({where:mocks.where})})})}));
vi.mock("@/db/research-repository",()=>({ResearchRepository:class {get=mocks.get;create=mocks.create;}}));
vi.mock("@/db/acquisition-repository",()=>({AcquisitionRepository:class {memberships=mocks.members;}}));
vi.mock("./research-service",()=>({researchWorker:mocks.worker}));
import { dispatchBusinessPeople } from "./business-research-people";
const parent = {id:"00000000-0000-4000-8000-000000000001",mandateId:"mandate",createdBy:"user",status:"complete",config:{workflow:"business",findPeople:true,peopleBudget:{maxCompanies:2,maxPages:2},geography:"Australia"}};
const target = {id:"target",domain:"instruments.example.com",companyName:"Example Instruments"};
beforeEach(()=>{
  vi.resetAllMocks();
  mocks.get.mockResolvedValue(parent);
  mocks.members.mockResolvedValue([{target,assessment:{stage:"identified"}}]);
  mocks.create.mockImplementation(async(id)=>({id,status:"queued"}));
  mocks.where.mockResolvedValueOnce([]).mockResolvedValueOnce([
    {targetId:target.id,sourceUrl:"https://instruments.example.com/",evidence:{kind:"company",website:"https://instruments.example.com/"}},
    {targetId:target.id,sourceUrl:"https://instruments.example.com/",evidence:{kind:"product",relevance:"relevant"}},
  ]);
});
it("dispatches a separately bounded child with stable identity and parent ownership",async()=>{
  await dispatchBusinessPeople("org",parent.id);
  const [id,mandate,user,config] = mocks.create.mock.calls[0];
  expect(id).toMatch(/^[\da-f-]{36}$/);
  expect([mandate,user]).toEqual(["mandate","user"]);
  expect(config).toMatchObject({parentJobId:parent.id,purpose:"people",targetId:target.id,maxPeopleSearches:1,budget:{maxPages:2,maxModelCalls:2,maxMinutes:5}});
  expect(mocks.worker).toHaveBeenCalledWith(`/jobs/${id}`,"POST");
});
it("never creates another child while one is active",async()=>{
  mocks.where.mockReset().mockResolvedValue([{id:"child",status:"crawling",config:{targetId:"other"}}]);
  await dispatchBusinessPeople("org",parent.id);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("stops at the approved company cap including unsuccessful jobs",async()=>{
  mocks.where.mockReset().mockResolvedValue([{id:"a",status:"failed",config:{targetId:"a"}},{id:"b",status:"partial",config:{targetId:"b"}}]);
  await dispatchBusinessPeople("org",parent.id);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("respects cancellation of the people phase",async()=>{
  mocks.where.mockReset().mockResolvedValue([{status:"cancelled"}]);
  await dispatchBusinessPeople("org",parent.id);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("does not dispatch when people research was not selected",async()=>{
  mocks.get.mockResolvedValue({...parent,config:{...parent.config,findPeople:false}});
  await dispatchBusinessPeople("org",parent.id);
  expect(mocks.create).not.toHaveBeenCalled();
});

it("runs company facts before the people phase using a separate approved budget", async () => {
  mocks.get.mockResolvedValue({ ...parent, config: { ...parent.config, companyBudget: { maxCompanies: 2, maxPages: 3 } } });
  await dispatchBusinessPeople("org", parent.id);
  expect(mocks.create.mock.calls[0][3]).toMatchObject({ purpose: "firmographics", parentJobId: parent.id, targetId: target.id, budget: { maxPages: 3, maxModelCalls: 3 } });
});
it("counts failed company jobs against the cap then advances to people", async () => {
  mocks.get.mockResolvedValue({ ...parent, config: { ...parent.config, companyBudget: { maxCompanies: 1, maxPages: 3 } } });
  mocks.where.mockReset().mockResolvedValueOnce([{ id:"facts", status: "failed", config:{targetId:target.id} }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ targetId: target.id, sourceUrl: "https://instruments.example.com/", evidence: {kind:"company",website:"https://instruments.example.com/"} }, { targetId:target.id,sourceUrl:"https://instruments.example.com/",evidence:{kind:"product",relevance:"relevant"} }]);
  await dispatchBusinessPeople("org", parent.id);
  expect(mocks.create.mock.calls[0][3].purpose).toBe("people");
});
it("stops automatic follow-ups when company research is cancelled", async () => {
  mocks.get.mockResolvedValue({ ...parent, config: { ...parent.config, companyBudget: { maxCompanies: 2, maxPages: 3 } } });
  mocks.where.mockReset().mockResolvedValue([{ status: "cancelled" }]);
  await dispatchBusinessPeople("org", parent.id);
  expect(mocks.create).not.toHaveBeenCalled();
});
