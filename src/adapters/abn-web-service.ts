import { z } from 'zod';
import { abnChecksum, type AbnCandidate } from '@/domain/abn-public-lookup.mjs';
import type { AbnRecord } from '@/domain/abn-resolution.mjs';

const abn = z.string().refine(abnChecksum);
const detailSchema = z.object({
  Message: z.literal(''), Abn: abn, EntityName: z.string().min(1),
  AbnStatus: z.enum(['Active', 'Cancelled']), AbnStatusEffectiveFrom: z.string(),
  BusinessName: z.array(z.string()), AddressPostcode: z.string(), AddressState: z.string(),
});
const searchSchema = z.object({
  Message: z.literal(''), Names: z.array(z.object({
    Abn: abn, Name: z.string().min(1), NameType: z.string(),
    AbnStatus: z.enum(['0000000001', '0000000002']), IsCurrent: z.boolean(),
    Postcode: z.string(), State: z.string(),
  })),
});

// Parse JSONP as data only. Never evaluate provider JavaScript or retain GUID URLs.
function payload(body: string): unknown {
  const match = body.match(/^\s*callback\(([\s\S]*)\)\s*;?\s*$/);
  return JSON.parse(match ? match[1] : body);
}

export function parseWebServiceSearch(body: string): AbnCandidate[] {
  return searchSchema.parse(payload(body)).Names.map(row => ({
    abn: row.Abn, name: row.Name, nameType: row.NameType,
    active: row.AbnStatus === '0000000001' && row.IsCurrent,
    location: `${row.Postcode} ${row.State}`.trim(),
    sourceUrl: `https://abr.business.gov.au/ABN/View?abn=${row.Abn}`,
  }));
}

export function parseWebServiceRecord(body: string, expectedAbn: string): AbnRecord {
  const row = detailSchema.parse(payload(body));
  if (row.Abn !== expectedAbn) throw new Error('Unexpected ABN service record');
  return {
    abn: row.Abn, entityName: row.EntityName, active: row.AbnStatus === 'Active',
    names: row.BusinessName, location: `${row.AddressPostcode} ${row.AddressState}`.trim(),
    quote: `Entity name: ${row.EntityName}; ABN: ${row.Abn}; ABN status: ${row.AbnStatus} from ${row.AbnStatusEffectiveFrom}`,
    sourceUrl: `https://abr.business.gov.au/ABN/View?abn=${row.Abn}`,
    registrySource: 'web_service',
  };
}
