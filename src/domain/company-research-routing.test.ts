import {expect,it} from "vitest";
import {companyPeopleQuery,companyResultMatches} from "./company-research-routing";
const domain="instruments.example.com", company="Example Instruments";
const result=(title:string,snippet="",url="https://directory.example.com/profile")=>({title,snippet,url});
it("reads own pages and identified profiles, not unrelated companies or loose single-word matches",()=>{
 expect(companyResultMatches(result("","",`https://${domain}/team`),company,domain)).toBe(true);
 expect(companyResultMatches(result("Example Instruments company profile"),company,domain)).toBe(true);
 expect(companyResultMatches(result("Other Instruments company profile"),company,domain)).toBe(false);
 expect(companyResultMatches(result("Example software"),"Example",domain)).toBe(false);
 expect(companyResultMatches(result("Example",`Website: ${domain}`),"Example",domain)).toBe(true);
 expect(companyResultMatches(result("Example",`Website: www.${domain}`),"Example",domain)).toBe(true);
 expect(companyResultMatches(result("Example",`Website: fake.${domain}`),"Example",domain)).toBe(false);
 expect(companyResultMatches(result("Example",`Website: ${domain}.evil.com`),"Example",domain)).toBe(false);
});
it("uses supplied aliases and evidenced legal names without inferring shared ownership",()=>{
 expect(companyResultMatches(result("Trading Instruments staff"),"Example Group / Trading Instruments",domain)).toBe(true);
 expect(companyResultMatches(result("Example Holdings Pty Ltd director"),company,domain,"Example Holdings Pty Ltd")).toBe(true);
 expect(companyResultMatches(result("Example Holdings Pty Ltd director"),company,domain)).toBe(false);
 expect(companyPeopleQuery(company,domain)).toContain(`"${domain}"`);
});
