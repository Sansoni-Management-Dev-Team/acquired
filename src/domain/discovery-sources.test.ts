import { expect, it } from "vitest";
import { directorySource, serviceBusinessDomain, unreadableDiscoverySource } from "./discovery-sources";

it("treats known directories, registers and social profiles as sources rather than businesses", () => {
  for (const url of ["https://ensun.io/search/au/casket-hardware", "https://www.yellowpages.com.au/vic/company", "https://au.linkedin.com/company/example", "https://www.datanyze.com/companies/example/1"]) expect(directorySource(url)).toBe(true);
  expect(directorySource("https://caskets.example.com/")).toBe(false);
});
it("recognises an unknown listing page from its outbound links and vocabulary", () => {
  const links = Array.from({ length: 10 }, (_, i) => `[Supplier ${i}](https://supplier-${i}.example.com/)`).join("\n");
  expect(directorySource("https://association.example.org/members", `# Member directory\n24 members\n${links}`)).toBe(true);
  expect(directorySource("https://caskets.example.com/partners", `# Our partners\n${links}`)).toBe(false);
  expect(directorySource("https://caskets.example.com/", "# Example Caskets\nWe supply 24 results for [Handles](/handles) and [Linings](/linings)")).toBe(false);
});
it("skips funeral-service domains and unreadable hosts in discovery", () => {
  for (const url of ["https://www.finneyfunerals.com.au/coffins-caskets", "https://goodcremations.example.com/", "https://www.hamiltonfunerals.com.au/service/caskets"]) expect(serviceBusinessDomain(url)).toBe(true);
  for (const url of ["https://www.funeralproducts.com.au/", "https://caskets.example.com/", "https://urncentre.example.com/"]) expect(serviceBusinessDomain(url)).toBe(false);
  for (const url of ["https://duckduckgo.com/y.js", "https://www.zoominfo.com/top-lists/x", "https://www.instagram.com/x"]) expect(unreadableDiscoverySource(url)).toBe(true);
  expect(unreadableDiscoverySource("https://caskets.example.com/")).toBe(false);
});
