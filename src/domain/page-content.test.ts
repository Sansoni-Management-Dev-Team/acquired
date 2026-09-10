import { expect, it } from "vitest";
import { relevantExcerpt, stripBoilerplate } from "./page-content";

// Anonymised structure of a manufacturer's team page: long form scaffolding and
// navigation precede the team listing, which sits beyond a fixed 12,000-character cut.
const forms = Array.from({ length: 60 }, (_, i) => `## Request form ${i}\nRequest received\n\nState NSW NT QLD SA TAS VIC WA\n\nYour Name (required)\n\nYour Email (required)\n\n### Drag & Drop Files Here\nor\n[Browse Files](https://caskets.example.com/about/our-team/)\n0 of 10\n`).join("\n");
const nav = Array.from({ length: 30 }, (_, i) => `  * [Product ${i}](https://caskets.example.com/products/${i}/)`).join("\n");
const team = `# Meet our team\nOur team members are our strength and the reason we have grown Example Caskets into one of the country's best casket manufacturers.\n\n![](https://caskets.example.com/wp-content/uploads/jane.jpg)\nJane Citizen\nManaging Director\n![](https://caskets.example.com/wp-content/uploads/sam.jpg)\nSam Sample\nDirector & National Production Manager\nAlex Example\nGeneral Manager of Operations\n[0400 000 000](tel:0400%20000%20000) alexe@caskets.example.com\nChris Person\nManager - Queensland\n[0400 000 001](tel:0400%20000%20001) chrisp@caskets.example.com\n`;
const page = `${forms}\n${nav}\n\n${team}\n### Your reliable partner\nContact us to discuss the Example Caskets difference.\n`;

it("keeps the team listing when the page is longer than the excerpt budget", () => {
  expect(page.indexOf("Jane Citizen")).toBeGreaterThan(12000);
  const excerpt = relevantExcerpt(page, { maxChars: 12000, priorities: ["size", "leadership", "contact"], identity: ["Example Caskets"] });
  expect(excerpt.length).toBeLessThanOrEqual(12000);
  expect(excerpt).toContain("Jane Citizen\nManaging Director");
  expect(excerpt).toContain("alexe@caskets.example.com");
  expect(excerpt).not.toContain("Request received");
  expect(excerpt).not.toContain("Drag & Drop");
  expect(excerpt).not.toContain("[Product 3]");
});

it("returns a short page unchanged apart from boilerplate", () => {
  const short = "# Example Caskets\n\nWe employ 40 staff.\n\n[Home](/) \n[About](/about)\n[Contact](/contact)\n[Shop](/shop)\n\nRequest received";
  expect(relevantExcerpt(short, { maxChars: 12000 })).toBe("# Example Caskets\n\nWe employ 40 staff.");
});

it("emits chosen sections in page order and preserves verbatim lines", () => {
  const text = `# Title\n\n${"Filler paragraph about delivery. ".repeat(80)}\n\nWe currently employ 25 staff across two sites.\n\n${"More filler about shipping. ".repeat(80)}\n\nFounded in 1973 by Jane Citizen.`;
  const excerpt = relevantExcerpt(text, { maxChars: 400, priorities: ["size", "financial"] });
  expect(excerpt.indexOf("# Title")).toBe(0);
  expect(excerpt.indexOf("We currently employ 25 staff")).toBeLessThan(excerpt.indexOf("Founded in 1973"));
  expect(excerpt).not.toContain("Filler paragraph");
});

it("drops navigation runs but keeps single labelled links used for identity", () => {
  const profile = "# Example Caskets\nWebsite\n[www.caskets.example.com](//www.caskets.example.com)\n[Home](/)\n[Pricing](/pricing)\n[Sign in](/login)\n### Employees\n98";
  const cleaned = stripBoilerplate(profile);
  expect(cleaned).toContain("Website\n[www.caskets.example.com](//www.caskets.example.com)");
  expect(cleaned).not.toContain("[Pricing]");
  expect(cleaned).toContain("### Employees\n98");
});
