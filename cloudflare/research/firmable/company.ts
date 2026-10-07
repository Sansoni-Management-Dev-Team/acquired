import { labels, normalize, type RecordData } from './transport';
const object = (value: unknown): RecordData => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordData : {};
const strings = (value: unknown):string[] => typeof value==='string'&&value.trim()?[value.trim()]:(Array.isArray(value)?value:Object.values(object(value))).flatMap(item=>typeof item==='string'&&item.trim()?[item.trim()]:item&&typeof item==='object'?[object(item).value,object(item).email,object(item).number].filter((part):part is string=>typeof part==='string'&&Boolean(part.trim())).slice(0,1):[]);
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
  const existingDetails=object(raw.company_details);
  const abn = identifier('abn') || (typeof industryCodes.abn === 'string' ? industryCodes.abn : null);
  const acn = identifier('acn') || (typeof industryCodes.acn === 'string' ? industryCodes.acn : null);
  return {
    ...normalize(raw),
    industry_codes: {...industryCodes, ...(abn ? {abn} : {}), ...(acn ? {acn} : {})},
    abn, acn, company_emails: strings(regional.emails ?? raw.company_emails), company_phones: strings(regional.phones ?? raw.company_phones),
    company_details: {
      ...existingDetails,country, available: Object.keys(regional).length > 0 || existingDetails.available===true,
      address: regional.address ?? existingDetails.address ?? null, locations: Array.isArray(regional.locations) ? regional.locations : Array.isArray(existingDetails.locations)?existingDetails.locations:[],
      year_founded: regional.year_founded ?? existingDetails.year_founded ?? null, org_registers: regional.org_registers ?? existingDetails.org_registers ?? null,
      business_identifiers: {...object(existingDetails.business_identifiers),...identifiers}, social_media: regional.social_media || existingDetails.social_media || raw.social_media || null,
      employee_count: typeof regional.employee_count === 'number' ? regional.employee_count : existingDetails.employee_count ?? null,
      employee_band: labels(regional.company_size) || existingDetails.employee_band || null, revenue_band: labels(regional.revenue) || existingDetails.revenue_band || null,
    },
    available_people_count: typeof raw.available_people_count==='number'?raw.available_people_count:null,
    people_summary: raw.people_summary&&typeof raw.people_summary==='object'?object(raw.people_summary):{status: 'not_requested'} as RecordData,
  };
}
