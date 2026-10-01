import { expect, it } from "vitest";
import { snippetSizeEstimates } from "./snippet-estimates";
const config = { companyName: "Example Sheeting", companyDomain: "sheeting.example.com" };
it("records size and revenue estimates from identity-matched snippets as search-snippet evidence", () => {
  const results = [
    { url: "https://profiles.example.net/example-sheeting-management", title: "Example Sheeting Management Team | Org Chart", snippet: "**Example Sheeting** employs 39 employees. The Example Sheeting management team includes Jane Citizen (Managing Director)." },
    { url: "https://profiles.example.org/companies/example-sheeting", title: "Example Sheeting Information", snippet: "Example Sheeting is a Plastics Manufacturing company located in Dandenong South, Victoria with $16.1 million in revenue and 38 employees. Find top employees." },
    { url: "https://social.example.com/company/example-sheeting", title: "Example Sheeting - Social", snippet: "Example Sheeting | 978 followers on Social. Manufacturer of sheet." },
    { url: "https://unrelated.example.net/other", title: "Other Co", snippet: "Other Co employs 500 employees." },
  ];
  const estimates = snippetSizeEstimates(results, config);
  expect(estimates.map(e => [e.kind, e.value, e.sourceUrl])).toEqual([
    ["headcount", "39 employees", "https://profiles.example.net/example-sheeting-management"],
    ["headcount", "38 employees", "https://profiles.example.org/companies/example-sheeting"],
    ["revenue", "$16.1 million", "https://profiles.example.org/companies/example-sheeting"],
  ]);
  expect(estimates[0].quote).toBe("Example Sheeting employs 39 employees.");
  expect(estimates.every(e => e.factMetadata?.basis === "search_snippet")).toBe(true);
});
it("ignores follower counts, contact-record counts and single-word names without the website", () => {
  expect(snippetSizeEstimates([{ url: "https://profiles.example.net/x", title: "Example Sheeting", snippet: "Example Sheeting has 900 followers. Access 27 verified contacts." }], config)).toEqual([]);
  expect(snippetSizeEstimates([{ url: "https://profiles.example.net/x", title: "Acme", snippet: "Acme employs 40 employees." }], { companyName: "Acme", companyDomain: "acme.example.com" })).toEqual([]);
});

it('rejects competitors and revenue per employee instead of attributing them to Headland', () => {
 const headland = {companyName:'Headland Technology',companyDomain:'headland.au'};
 const estimate = (snippet: string) => snippetSizeEstimates([{url:'https://directory.example.com/headland', title:'Headland Technology revenue', snippet}], headland).filter(f=>f.kind==='revenue');
 expect(estimate('Headland Technology competitors include CEA. CEA revenue is $181.6M.')).toEqual([]);
 expect(estimate('Headland Technology revenue per employee is $528.1K.')).toEqual([]);
 expect(estimate('Headland Technology revenue: $528.1K per employee.')).toEqual([]);
 expect(estimate('CEA has $181.6M revenue compared with Headland Technology.')).toEqual([]);
 expect(estimate('Headland Technology supplies CEA, which has $181.6M revenue.')).toEqual([]);
 expect(estimate('Headland Technology estimated annual revenue is $78.2M.')).toMatchObject([{value:'$78.2M',factMetadata:{basis:'search_snippet'}}]);
});
