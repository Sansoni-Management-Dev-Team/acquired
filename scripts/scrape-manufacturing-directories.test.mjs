import { expect, test } from "vitest";

import {
  deduplicateBusinesses,
  parseAmtilDetail,
  parseAmtilDirectory,
  parseAustralianManufacturingDetail,
} from "./scrape-manufacturing-directories.mjs";

test("parses Australian Manufacturing directory fields", () => {
  const html = `
    <div id="wpbdp-listing-10">
      <div class="listing-thumbnail"><img data-src="https://images.example/logo.jpg"></div>
      <div class="wpbdp-field-display wpbdp-field-brief_description">
        <span class="field-label">Brief Description</span><div class="value">Precision parts</div>
      </div>
      <div class="wpbdp-field-display wpbdp-field-main_address">
        <span class="field-label">Main Address</span><div class="value">1 Smith St, Melbourne VIC 3000</div>
      </div>
      <div class="wpbdp-field-display wpbdp-field-phone">
        <span class="field-label">Phone</span><div class="value">03 9000 0000</div>
      </div>
      <div class="wpbdp-field-display wpbdp-field-website">
        <span class="field-label">Website</span><div class="value"><a href="https://example.com/">Example</a></div>
      </div>
      <div class="wpbdp-field-display wpbdp-field-keywords">
        <span class="field-label">Keywords (comma separated)</span><div class="value">laser cutting, fabrication</div>
      </div>
    </div><script type="application/ld+json">{}</script>`;

  expect(parseAustralianManufacturingDetail(html)).toEqual({
    address: "1 Smith St, Melbourne VIC 3000",
    categories: [],
    description: null,
    email: null,
    extraFields: {
      brief_description: "Precision parts",
      main_address: "1 Smith St, Melbourne VIC 3000",
      phone: "03 9000 0000",
      website: "Example",
      keywords_comma_separated: "laser cutting, fabrication",
    },
    imageUrl: "https://images.example/logo.jpg",
    keywords: ["laser cutting", "fabrication"],
    phone: "03 9000 0000",
    postcode: "3000",
    state: "VIC",
    website: "https://example.com/",
  });
});

test("parses AMTIL directory rows and details", () => {
  const directory = `<table><tr><td><a href="https://amtil.com.au/manufacturelink/acme-pty-ltd/">Acme Pty Ltd</a></td><td>Dandenong VIC 3175</td></tr></table>`;
  expect(parseAmtilDirectory(directory)).toEqual([
    {
      location: "Dandenong VIC 3175",
      name: "Acme Pty Ltd",
      postcode: "3175",
      sourceId: "acme-pty-ltd",
      sourceUrl: "https://amtil.com.au/manufacturelink/acme-pty-ltd/",
      state: "VIC",
    },
  ]);

  const detail = `
    <div class="manufacturedetails">
      <div class="company-logo"><img src="https://example.com/logo.png"></div>
      <div class="company-details">
        <p><strong>Alex Smith - Managing Director</strong></p>
        <p class="add">1 Smith St, Dandenong VIC 3175</p>
        <p><a href="tel:+61390000000">+61 3 9000 0000</a></p>
        <p><a href="mailto:alex@example.com" class="mail">alex@example.com</a></p>
        <p><a href="https://example.com" target="_blank" class="globe">Website</a></p>
      </div><div class="company-social-links"></div>
      <div class="company-desc"><div><p>Makes precision parts.</p></div></div>
      <script> jQuery(document)</script>
      <div class="capability-section"><div class="capability-blocks">
        <div class="capability-block"><h3>Industry Sectors</h3><p>Aerospace, Defence</p></div>
        <div class="capability-block"><h3>Additive Manufacturing</h3></div>
      </div></div>
    </div><footer id="colophon">`;
  const parsed = parseAmtilDetail(detail);
  expect(parsed.contactName).toBe("Alex Smith");
  expect(parsed.contactTitle).toBe("Managing Director");
  expect(parsed.website).toBe("https://example.com/");
  expect(parsed.capabilities).toEqual({
    "Industry Sectors": ["Aerospace", "Defence"],
    "Additive Manufacturing": [],
  });
});

test("deduplicates records across sources by website", () => {
  const businesses = deduplicateBusinesses([
    {
      name: "Acme Manufacturing Pty Ltd",
      website: "https://www.acme.example/about",
      state: "VIC",
      sourceRecord: { source: "australian-manufacturing", sourceId: "1" },
    },
    {
      name: "ACME Manufacturing",
      website: "https://acme.example/",
      description: "A longer description of the business.",
      state: "VIC",
      sourceRecord: { source: "amtil", sourceId: "acme" },
    },
  ]);

  expect(businesses).toHaveLength(1);
  expect(businesses[0].sourceRecords).toHaveLength(2);
  expect(businesses[0].description).toBe("A longer description of the business.");
  expect(businesses[0].duplicateMatchKeys).toEqual([
    "domain:acme.example",
    "name-area:acme manufacturing:vic",
  ]);
});

test("does not merge differently named businesses that share a phone number", () => {
  const businesses = deduplicateBusinesses([
    {
      name: "Acme Manufacturing Pty Ltd",
      phone: "03 9000 0000",
      state: "VIC",
      sourceRecord: { source: "australian-manufacturing", sourceId: "1" },
    },
    {
      name: "Example Engineering Pty Ltd",
      phone: "+61 3 9000 0000",
      state: "VIC",
      sourceRecord: { source: "australian-manufacturing", sourceId: "2" },
    },
  ]);

  expect(businesses).toHaveLength(2);
});

test.each([
  ["4 Capital Place, Rouse Hill, NSW, 2155", "NSW", "2155"],
  ["90 Northlink Place, Queensland, Australia, 4014", "QLD", "4014"],
  ["2/65 Holder Way, Malaga 6090 WA", "WA", "6090"],
  ["36 Industry Place, Bayswater, VIC", "VIC", null],
  ["Reservoir, Victoria, Australia3073", "VIC", "3073"],
])("normalizes Australian address variants", (address, state, postcode) => {
  const detail = parseAustralianManufacturingDetail(`
    <div id="wpbdp-listing-10">
      <div class="wpbdp-field-display"><span class="field-label">Main Address</span><div class="value">${address}</div></div>
    </div><script type="application/ld+json">{}</script>`);

  expect(detail.state).toBe(state);
  expect(detail.postcode).toBe(postcode);
});
