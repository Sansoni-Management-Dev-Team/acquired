import { FirmableClient } from "./firmable-client";
import { GooglePlacesClient } from "./google-places-client";

const companies = [
  ["harbour-industrial.example", "Harbour Industrial Services", "Richmond", 1986, 64, "$10M-$20M", ["Industrial services", "Building maintenance"]],
  ["northstar-building.example", "Northstar Building Systems", "Dandenong", 1994, 48, "$5M-$10M", ["Building services", "HVAC"]],
  ["laneway-mechanical.example", "Laneway Mechanical Group", "Footscray", 1978, 92, "$20M-$50M", ["Mechanical services", "Industrials"]],
  ["yarrabend-facilities.example", "Yarra Bend Facilities", "Abbotsford", 2003, 37, "$5M-$10M", ["Facilities services", "Building services"]],
  ["southernplant.example", "Southern Plant Reliability", "Moorabbin", 1989, 75, "$10M-$20M", ["Industrial maintenance", "Engineering services"]],
  ["civicfire.example", "Civic Fire Compliance", "Preston", 1998, 31, "$2M-$5M", ["Fire protection", "Building services"]],
  ["westgateelectrical.example", "Westgate Electrical Projects", "Altona", 2006, 56, "$10M-$20M", ["Electrical services", "Industrials"]],
  ["meridianaccess.example", "Meridian Access Solutions", "Braeside", 1991, 44, "$5M-$10M", ["Building services", "Access systems"]],
  ["portsidefabrication.example", "Portside Fabrication Services", "Williamstown", 1982, 83, "$20M-$50M", ["Industrial fabrication", "Industrials"]],
  ["rangesair.example", "Ranges Air & Mechanical", "Bayswater", 2001, 39, "$5M-$10M", ["Mechanical services", "HVAC"]],
] as const;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-acquired-fixture": "true" } });
}

function companyByDomain(domain: string) {
  return companies.find(([candidate]) => candidate === domain);
}

function companyById(id: string) {
  const index = Number(id.replace(/^fixture-company-/, ""));
  return Number.isInteger(index) ? companies[index - 1] : undefined;
}

export async function fixtureProviderFetch(input: string | URL | Request, init?: RequestInit) {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);

  if (url.pathname.endsWith("/places:searchText")) {
    return response({ places: [
      { id: "fixture-no-site-1", displayName: { text: "Fictional Listing Without Website" }, formattedAddress: "Melbourne VIC 3000, Australia", primaryType: "contractor", types: ["contractor"] },
      ...companies.map(([domain, name, suburb], index) => ({
        id: `fixture-place-${index + 1}`,
        displayName: { text: name, languageCode: "en" },
        formattedAddress: `${10 + index} Example Road, ${suburb} VIC 3000, Australia`,
        websiteUri: `https://${domain}`,
        primaryType: index % 2 ? "general_contractor" : "consultant",
        types: [index % 2 ? "general_contractor" : "consultant", "point_of_interest", "establishment"],
        addressComponents: [
          { longText: suburb, shortText: suburb, types: ["locality"] },
          { longText: "Victoria", shortText: "VIC", types: ["administrative_area_level_1"] },
        ],
      })),
    ] });
  }

  if (url.pathname.endsWith("/company")) {
    const domain = url.searchParams.get("fqdn") || "";
    const company = companyByDomain(domain);
    if (!company) return response({ error: "Company profile not found" }, 500);
    const index = companies.indexOf(company);
    const [fqdn, name, suburb, yearFounded, employeeCount, revenue, industries] = company;
    return response({
      id: `fixture-company-${index + 1}`, name, fqdn, website: `https://${fqdn}`,
      description: `${name} is a fictional Victorian operator used to test the acquisition workflow without external provider calls.`,
      tagline: "Reliable service, built for the long term", company_type: "Privately Held", company_size: `${employeeCount} employees`,
      revenue, au_employee_count: employeeCount, year_founded: yearFounded, industries,
      keywords: ["maintenance", "compliance", "field service"], hq_location: `${suburb}, Victoria, Australia`, states: ["VIC"], locations: [suburb],
      industry_codes: { abn: `990000000${String(index + 1).padStart(2, "0")}`, acn: `000000${String(index + 1).padStart(3, "0")}`, anzsic: "3299" },
      abn_operation_status: "Active", linkedin: `https://www.linkedin.com/company/fixture-company-${index + 1}`,
    });
  }

  if (url.pathname.endsWith("/people/search") && init?.method === "POST") {
    const body = JSON.parse(String(init.body || "{}")) as { companyId?: string };
    const company = body.companyId ? companyById(body.companyId) : undefined;
    if (!company || !body.companyId) return response({ data: [] });
    return response({ data: [
      { person_id: `${body.companyId}-owner`, position: "Owner and Managing Director", seniority: "Owner", department: "Executive", email_available: true, phone_available: true },
      { person_id: `${body.companyId}-director`, position: "Operations Director", seniority: "Director", department: "Operations", email_available: true, phone_available: false },
    ] });
  }

  if (url.pathname.endsWith("/people")) {
    const personId = url.searchParams.get("id") || "";
    const match = personId.match(/^(fixture-company-\d+)-(owner|director)$/);
    const company = match ? companyById(match[1]) : undefined;
    if (!match || !company) return response({ error: "Person not found" }, 404);
    const role = match[2];
    const first = role === "owner" ? "Morgan" : "Taylor";
    const last = company[1].split(/\s+/)[0];
    return response({
      id: personId,
      full_name: `${first} ${last}`,
      position: role === "owner" ? "Owner and Managing Director" : "Operations Director",
      seniority: role === "owner" ? "Owner" : "Director",
      department: role === "owner" ? "Executive" : "Operations",
      work_email: `${first.toLowerCase()}@${company[0]}`,
      phones: role === "owner" ? [{ number: "+61400000000", is_dnd: false }] : [],
      linkedin_url: `https://www.linkedin.com/in/${personId}`,
    });
  }

  throw new Error(`Fixture provider blocked an unexpected request: ${init?.method || "GET"} ${url.pathname}`);
}

export function createFixtureProviderClients() {
  return {
    places: new GooglePlacesClient({ apiKey: "fixture-only", baseUrl: "https://fixture.invalid/places/v1", fetch: fixtureProviderFetch }),
    firmable: new FirmableClient({ apiKey: "fixture-only", baseUrl: "https://fixture.invalid/firmable", fetch: fixtureProviderFetch, fictionalise: true, retries: 0 }),
  };
}
