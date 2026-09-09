import { expect, it } from "vitest";
import { searchResults, canonicalSearchUrl } from "./cloudflare-search";
import { peopleSearchLeads, peopleFollowupQuery, mergePeopleSearchLeads } from "./people-search-results";
it("keeps result snippets attached to their own source and collapses locale profiles", () => {
 const page = '## [Alex E. - Director | LinkedIn](https://au.linkedin.com/in/alexexample/nl)\n[Director at **Example Instruments**](https://au.linkedin.com/in/alexexample/nl)\n[Unrelated person CEO](https://other.example.com/)\n## [Duplicate](https://www.linkedin.com/in/alexexample)\n## [Another business](https://business.example.com/)\n[Sam Sample is CEO at Another Business](https://business.example.com/)';
 const results=searchResults(page);
 expect(results).toHaveLength(2);
 expect(results[0]).toMatchObject({url:'https://www.linkedin.com/in/alexexample',snippet:'Director at Example Instruments'});
 const leads=peopleSearchLeads(results,'Example Instruments','query','2026-09-09T00:00:00Z');
 expect(leads).toHaveLength(1);
 expect(peopleFollowupQuery('Example Instruments',leads)).toBe('"Alex" "Example Instruments"');
 expect(mergePeopleSearchLeads([...leads,...leads])).toHaveLength(1);
 expect(canonicalSearchUrl('https://127.0.0.1/')).toBeNull();
});
it("does not use excluded people-finder results or an unrelated company as a people lead",()=>{
 const results=[{url:'https://contactout.com/alex',title:'Alex Example Director',snippet:'Example Instruments'}, {url:'https://linkedin.com/in/sam',title:'Sam Sample CEO',snippet:'Another Business'}];
 expect(peopleSearchLeads(results,'Example Instruments','query','now')).toEqual([]);
 expect(peopleFollowupQuery('Example Instruments',[], 'Example Holdings Pty Ltd')).toContain('"Example Holdings Pty Ltd"');
});
it("uses a trading-name alias and excludes explicit former-role results",()=>{
 const former={url:'https://linkedin.com/in/alex',title:'Alex Example stepped down as CEO',snippet:'Example Instruments'};
 expect(peopleSearchLeads([former],'Example Instruments','query','now')).toEqual([]);
 expect(peopleFollowupQuery('Example Holdings / Example Instruments',[])).toBe('"Example Instruments" LinkedIn');
});
it("preserves a company-associated profile when the role is not published",()=>{
 const result={url:'https://www.linkedin.com/in/alexexample',title:'Alex Example - Example Instruments | LinkedIn',snippet:'Experience: Example Instruments'};
 const leads=peopleSearchLeads([result],'Example Instruments','query','now');
 expect(leads).toHaveLength(1);
 expect(leads[0].basis).toBe('search-result');
 expect(peopleFollowupQuery('Example Instruments',leads)).toBe('"Alex Example" "Example Instruments"');
 expect(peopleSearchLeads([{...result,title:'Alex Example - Example',snippet:'Experience: Example'}],'Example','query','now','example.com')).toEqual([]);
});
