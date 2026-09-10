import { describe, it, expect } from "vitest";
import {
  normalizeResearchFinding,
  catalogueProductFindings,
  statedSupplyFindings,
  orderResearchQueue,
  continueResearchConfig,
  researchQueries,
  groupResearchFindings,
  validateFindings,
  followUpLinks,
  type ResearchFinding,
  type ResearchConfig,
} from "./research";
const f: ResearchFinding = {
  kind: "capability",
  name: "National delivery",
  value: "National delivery",
  quote: "We provide National delivery for our instruments.",
  website: "https://example.com/",
};
describe("research quality", () => {
  it("investigates known domains evenly before discovering new businesses", () => {
    expect(orderResearchQueue(["https://new.example.com/", "https://optics.example.com/products", "https://optics.example.com/about", "https://sensors.example.com/products"], ["https://optics.example.com/", "https://sensors.example.com/"], "investigate", ["https://optics.example.com/other"])).toEqual(["https://sensors.example.com/products", "https://optics.example.com/products", "https://optics.example.com/about", "https://new.example.com/"]);
  });
  it("does not confuse materials and beneficiaries with purchasing customers", () => {
    expect(normalizeResearchFinding({...f, kind:"customer", value:"metal and plastic samples", quote:"We offer instruments for metal and plastic samples."})).toBeNull();
    expect(normalizeResearchFinding({...f, kind:"customer", value:"laboratories and hospitals", quote:"We supply instruments to laboratories and hospitals."})?.kind).toBe("customer");
  });
  it("moves business identifiers out of accreditation", () =>
    expect(
      normalizeResearchFinding({
        ...f,
        kind: "accreditation",
        name: "ABN",
        value: "12345678901",
      })?.kind,
    ).toBe("identifier"));
  it("rejects vague certification assertions", () =>
    expect(
      normalizeResearchFinding({
        ...f,
        kind: "accreditation",
        name: "National guidelines",
        quote: "Our products follow national guidelines.",
      }),
    ).toBeNull());
  it("requires a named standard and explicit certification assertion", () => {
    const cert = {
      ...f,
      kind: "accreditation" as const,
      name: "ISO 9001",
      value: "ISO 9001",
      quote: "Example Instruments is certified to ISO 9001.",
    };
    expect(normalizeResearchFinding(cert)).toEqual(cert);
    expect(
      normalizeResearchFinding({
        ...cert,
        quote: "Filter by ISO 9001 accredited suppliers",
      }),
    ).toBeNull();
  });
  it("rejects single-word fragments and general advice", () => {
    expect(normalizeResearchFinding({ ...f, value: "National" })).toBeNull();
    expect(
      normalizeResearchFinding({
        ...f,
        value: "natural environments",
        quote: "Natural environments are now an option.",
      }),
    ).toBeNull();
  });
  it("requires a stated subject to appear in evidence", () =>
    expect(
      validateFindings(
        [{ ...f, subject: "Unrelated Company" }],
        f.quote,
        f.website,
      ),
    ).toEqual([]));
  it("deduplicates company claims across source pages and removes unsupported legacy claims", () => {
    const saved = {
      id: "1",
      jobId: "job",
      sourceUrl: "https://example.com/",
      observedAt: "2026-01-01T00:00:00Z",
      confidence: 0.5,
      targetId: null,
      evidence: f,
    };
    const groups = groupResearchFindings([
      saved,
      { ...saved, id: "2", sourceUrl: "https://www.example.com/products" },
      { ...saved, id: "3", evidence: { ...f, value: "National" } },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].claims).toHaveLength(1);
    expect(groups[0].claims[0].sources).toHaveLength(2);
    expect(groups[0].excluded).toBe(1);
  });
  it("canonicalizes www aliases and favours unseen websites", () =>
    expect(
      orderResearchQueue(
        [
          "https://first.example.com/",
          "https://first.example.com/products",
          "https://second.example.com/",
        ],
        ["https://www.first.example.com/"],
      ),
    ).toEqual([
      "https://second.example.com/",
      "https://first.example.com/products",
    ]));
  it("splits long product descriptions into focused searches", () =>
    expect(
      researchQueries(["Industrial sensors: load cells, torque sensors"]),
    ).toEqual([
      "Industrial load cells supplier",
      "Industrial torque sensors supplier",
    ]));
  it("prioritizes supplier pages over consumer articles", () =>
    expect(
      followUpLinks(
        "[How to choose sensors](/blog/sensors) [Products](/products)",
        "https://example.com/",
        ["sensors"],
        [],
      ),
    ).toEqual(["https://example.com/products"]));
  it("continues only saved remaining work with new counters and an explicit budget", () => {
    const config: ResearchConfig = {
      seeds: [],
      searchTerms: ["sensors"],
      geography: "Australia",
      discover: true,
      approved: true,
      budget: { maxPages: 3, maxDomains: 3, maxMinutes: 10, maxModelCalls: 3 },
      runtime: {
        remaining: ["https://second.example.com/"],
        visited: ["https://first.example.com/"],
        attempts: [
          { url: "https://first.example.com/", status: "read", reason: "Read" },
        ],
      },
    };
    const resumed = continueResearchConfig(
      config,
      [],
      [],
      { ...config.budget, maxPages: 1 },
      "prior",
    );
    expect(resumed.discover).toBe(false);
    expect(resumed.runtime?.attempts).toEqual([]);
    expect(resumed.runtime?.remaining).toEqual(config.runtime?.remaining);
    expect(resumed.budget.maxPages).toBe(1);
  });
});

it("does not infer manufacturing from a partnership or a product range",()=>{
  const role={...f,kind:"business_role" as const,name:"Manufacturer",value:"shared passion",quote:"Our partnership is rooted in a shared passion."};
  expect(normalizeResearchFinding(role)).toBeNull();
  expect(normalizeResearchFinding({...role,value:"solid timber range",quote:"Our solid timber range is available."})).toBeNull();
  expect(normalizeResearchFinding({...role,value:"instrument manufacturers",quote:"We are instrument manufacturers."})).not.toBeNull();
});
it("downgrades adjacent finished goods when the research specifies parts",()=>{
  const product={...f,kind:"product" as const,name:"Finished devices",value:"complete devices",quote:"We supply complete devices for the optical industry.",relevance:"relevant" as const};
  expect(validateFindings([product],product.quote,f.website,["Optical components: lenses, filters"])[0].relevance).toBe("adjacent");
  const matching={...product,value:"optical lenses",quote:"We supply optical lenses."};
  expect(validateFindings([matching],matching.quote,f.website,["Optical components: lenses, filters"])[0].relevance).toBe("relevant");
});

describe("catalogue evidence", () => {
  const source = "https://optics.example.com/products";
  const listing = (name:string, id:number) => `[![](https://optics.example.com/images/${id}.jpg)](https://optics.example.com/product/${id})\n\n[${name}](https://optics.example.com/product/${id})`;
  const markdown = "Filter Products\n3 Products\n" + ["Precision optical sensor", "Digital optical sensor", "Compact optical sensor"].map(listing).join("\n\n");
  it("retains literal catalogue listings without inferring manufacturer or fit", () => {
    const findings = catalogueProductFindings(markdown, source, ["optical sensors"]);
    expect(findings).toHaveLength(2);
    expect(validateFindings(findings, markdown, source, ["optical sensors"])).toEqual(findings);
    expect(findings.every(f=>f.kind === "product" && f.relevance === "unclear")).toBe(true);
  });
  it("rejects menus, unrelated listings and third-party product links", () => {
    expect(catalogueProductFindings("[Optical sensors](/products)",source,["optical sensors"])).toEqual([]);
    expect(catalogueProductFindings(markdown,source,["steel fabrication"])).toEqual([]);
    expect(catalogueProductFindings(markdown,"https://other.example.com/",["optical sensors"])).toEqual([]);
    expect(normalizeResearchFinding({ ...f,kind:"product",name:"Catalogue product listing",value:"optical sensors",quote:"[optical sensors](/products)" })).toBeNull();
  });
});

describe("explicit website supply statements", () => {
  it("recovers exact claims without interpreting company identity or financial fit", () => {
    const page = "We are a wholesale supplier and only sell to laboratories. We supply optical sensors, load cells and test equipment.";
    const claims = statedSupplyFindings(page, "https://optics.example.com/", ["optical sensors"]);
    expect(claims.map(f=>f.kind)).toEqual(["business_role","product"]);
    expect(validateFindings(claims,page,"https://optics.example.com/")).toEqual(claims);
    expect(claims.every(f=>f.relevance === "unclear")).toBe(true);
  });
  it("does not turn planned or negative activity into a role", () => {
    expect(statedSupplyFindings("We are a manufacturer if funding is approved. We are a wholesale supplier but would never manufacture products.", "https://optics.example.com/", ["optical sensors"])).toEqual([]);
  });
});
  it("keeps a first-party product claim whose subject is the site's own company even when the quote omits the name", () => {
    const markdown = "# White Lily Urns\n\nWe have a large selection of cremation urns for adults in stock and available for purchase.";
    const finding = { kind: "product", name: "Cremation urns", value: "cremation urns for adults", quote: "We have a large selection of cremation urns for adults in stock and available for purchase.", website: "https://urns.example.com/", subject: "White Lily Urns", relevance: "relevant" };
    expect(validateFindings([finding], markdown, "https://urns.example.com/", ["Funeral consumables: urns and fittings"]).map(f => [f.kind, f.relevance, f.subject])).toEqual([["product", "relevant", undefined]]);
    expect(validateFindings([{ ...finding, subject: "Someone Else Pty Ltd" }], markdown, "https://urns.example.com/", ["urns"])).toEqual([]);
  });
