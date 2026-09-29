import { describe, expect, it } from "vitest";
import { emptyBrief } from "@/domain/acquisition";
import { briefResearchGeography, briefResearchSources, generateBriefResearchScope } from "./brief-research";

describe("research inputs from the acquisition brief", () => {
  it("uses the mandate geography and collects public source URLs once", () => {
    const brief = emptyBrief();
    brief.naturalLanguage = "Look at https://www.australianmanufacturing.com.au/australian-manufacturing-directory/ for leads.";
    brief.researchSources = ["https://www.australianmanufacturing.com.au/australian-manufacturing-directory/", "https://private.example/"];
    const geography = brief.criteria.find(item => item.key === "geography")!;
    geography.state = "specified";
    geography.value = "Victoria, New South Wales";
    expect(briefResearchGeography(brief)).toBe("VIC, NSW");
    expect(briefResearchSources(brief)).toEqual(["https://www.australianmanufacturing.com.au/australian-manufacturing-directory/"]);
  });

  it("requires a usable mandate geography", () => {
    expect(() => briefResearchGeography(emptyBrief())).toThrow("Set the mandate geography");
  });

  it("passes generated sectors to research without a second AI request", async () => {
    const brief = emptyBrief();
    brief.naturalLanguage = "Find gym supply businesses";
    const sectors = brief.criteria.find(item => item.key === "subsectors")!;
    sectors.state = "specified";
    sectors.value = "Fitness equipment supply; gym fit-out services";
    expect(await generateBriefResearchScope(brief)).toBe("Fitness equipment supply; gym fit-out services");
  });
});
