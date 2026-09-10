import { expect, it } from "vitest";
import { companyFactConflicts, companyFactSearchQuery, orderCompanyFactQueue } from "./company-facts";
import type { ResearchConfig, ResearchFinding } from "./research";
const config = { companyDomain: "instruments.example.com" } as ResearchConfig;
const count = (value: string) => ({ evidence: {kind:"headcount",value} as ResearchFinding });
it("surfaces conflicting counts and treats equivalent employee labels as the same range", () => {
  expect(companyFactConflicts([count("11-50"),count("11-50 employees")])).toEqual([]);
  expect(companyFactConflicts([count("11-50"),count("51-200 employees")])).toEqual(["headcount"]);
});
it("anchors size research to the website and reads it before matched numeric profiles", () => {
  expect(companyFactSearchQuery("Example Group / Old Brand",config.companyDomain!)).toBe('"instruments.example.com" employees');
  expect(orderCompanyFactQueue(["https://unrelated.example.com/about","https://instruments.example.com/","https://www.datanyze.com/companies/example/123","https://www.linkedin.com/company/example"],config)).toEqual(["https://instruments.example.com/","https://www.datanyze.com/companies/example/123","https://www.linkedin.com/company/example"]);
});
