import { expect, it, vi } from "vitest";
import { findApolloPeople } from "./apollo-people";
it("searches by domain and enriches prioritized people with personal reveals disabled", async () => {
 const fetcher = vi.fn().mockResolvedValueOnce(Response.json({people:[{id:"1",title:"General Manager"},{id:"2",title:"Owner"}]})).mockResolvedValueOnce(Response.json({person:{id:"2",name:"Juliet Example",title:"Owner",organization:{primary_domain:"example.com"}}})).mockResolvedValueOnce(Response.json({person:{id:"1",name:"Alex Example",title:"General Manager",organization:{primary_domain:"other.com"}}}));
 const result = await findApolloPeople("www.example.com","secret",fetcher);
 expect(result.people).toEqual([{id:"2",name:"Juliet Example",role:"Owner",sourceUrl:"https://app.apollo.io/#/people/2"}]);
 expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({q_organization_domains_list:["example.com"]});
 expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({id:"2",reveal_personal_emails:false,reveal_phone_number:false});
});
it("does not invent masked names, handles partial errors and bounds enrichment at five", async () => {
 const fetcher = vi.fn().mockResolvedValueOnce(Response.json({people:Array.from({length:12},(_,i)=>({id:String(i),title:"Director"}))})).mockResolvedValueOnce(new Response("denied",{status:403})).mockImplementation(async ()=>Response.json({person:{id:"x",name:"Sam Sm***",title:"Director",organization:{primary_domain:"example.com"}}}));
 const result = await findApolloPeople("example.com","secret",fetcher);
 expect(result.people).toEqual([]); expect(result.failed).toBe(1); expect(fetcher).toHaveBeenCalledTimes(6);
});
it("fails clearly for missing configuration and upstream failures without exposing the key", async () => {
 const fetcher=vi.fn().mockResolvedValue(new Response("private payload",{status:429}));
 await expect(findApolloPeople("example.com","",fetcher)).rejects.toThrow("APOLLO_API_KEY");
 expect(fetcher).not.toHaveBeenCalled();
 await expect(findApolloPeople("example.com","secret",fetcher)).rejects.toThrow("429");
});
