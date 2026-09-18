export const COMPANY_DATA_SOURCE = "Company data";

export function isCompanyDataSource(source: string | undefined | null) {
  return source === COMPANY_DATA_SOURCE || source?.toLowerCase().includes("firmable") === true;
}

/** Keeps legacy provider-labelled records safe to render without rewriting stored data. */
export function providerNeutralText(value: string) {
  return value
    .replace(/target\.firmable_people_synced/gi, "target.company_people_synced")
    .replace(/firmableId/gi, "companyDataId")
    .replace(/Company data saved; Firmable found no people/gi, "Company data saved; no people found")
    .replace(/People refreshed from the last known Firmable company/gi, "People refreshed from the last known company profile")
    .replace(/Refreshing Firmable company data/gi, "Refreshing company data")
    .replace(/Firmable refresh/gi, "Company data refresh")
    .replace(/finding Firmable people/gi, "finding people")
    .replace(/Found (\d+) Firmable people/gi, "Found $1 people")
    .replace(/Finding Firmable people/gi, "Finding people")
    .replace(/Loading (\d+) Firmable profiles/gi, "Loading $1 profiles")
    .replace(/Saving Firmable people/gi, "Saving people")
    .replace(/Loaded (\d+) of (\d+) Firmable profiles/gi, "Loaded $1 of $2 profiles")
    .replace(/Firmable People Search \+ Enrichment/gi, COMPANY_DATA_SOURCE)
    .replace(/\bFirmable\b/gi, COMPANY_DATA_SOURCE);
}
