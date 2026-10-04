import { labels, normalize, type RecordData } from './transport';
const object = (value: unknown): RecordData => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordData : {};
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [];
/** Expose regional company details while retaining the original provider payload.
 * Regional employee counts are not evidence of available contact profiles. */
export function expandCompanyProfile(raw: RecordData, country: string) {
  const regional = object(object(raw.region)[country]);
  const identifiers = object(regional.business_identifiers);
  const identifier = (name: string) => {
    const value = object(identifiers[name]).value;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };
  const industryCodes = object(raw.industry_codes);
  const abn = identifier('abn') || (typeof industryCodes.abn === 'string' ? industryCodes.abn : null);
  const acn = identifier('acn') || (typeof industryCodes.acn === 'string' ? industryCodes.acn : null);
  return {
    ...normalize(raw),
    industry_codes: {...industryCodes, ...(abn ? {abn} : {}), ...(acn ? {acn} : {})},
    abn, acn, company_emails: strings(regional.emails), company_phones: strings(regional.phones),
    company_details: {
      country, available: Object.keys(regional).length > 0,
      address: regional.address || null, locations: Array.isArray(regional.locations) ? regional.locations : [],
      business_identifiers: identifiers, social_media: regional.social_media || raw.social_media || null,
      employee_count: typeof regional.employee_count === 'number' ? regional.employee_count : null,
      employee_band: labels(regional.company_size) || null, revenue_band: labels(regional.revenue) || null,
    },
    available_people_count: null as number | null,
    people_summary: {status: 'not_requested'} as RecordData,
  };
}
