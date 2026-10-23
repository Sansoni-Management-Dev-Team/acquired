import{z}from'zod';
import type{FirmableFilters}from'./firmable-company-pipeline';
const record=z.record(z.string(),z.unknown());
const original=z.object({filters:record,operators:record,excluded:record}).strict();
const prediction=z.object({include:z.tuple([z.literal('AU')]),operator:z.literal('OR')}).strict();
/** /records/v2 already accepts filters.country={AU:'Australia'} in the shared
 * domain-lookup transport. Convert only an explicit, nonconflicting AU AI
 * prediction into that same shape. Never guess country from narrative or codes. */
export function firmablePaginationFilters(raw:FirmableFilters,predictedCountry:unknown,reviewedCountry:'AU'):FirmableFilters{
 z.literal('AU').parse(reviewedCountry);
 const saved=original.parse(raw),country=saved.filters.country,operator=saved.operators.country,negative=saved.excluded.country;
 if(negative!==undefined){const excluded=record.parse(negative);if(Object.hasOwn(excluded,'AU'))throw Error('pagination_country_conflict');}
 if(country!==undefined){const bound=z.object({AU:z.literal('Australia')}).strict().parse(country);void bound;if(operator!==undefined&&operator!=='OR')throw Error('pagination_country_conflict');if(predictedCountry!==undefined)prediction.parse(predictedCountry);return{filters:{...saved.filters},operators:{...saved.operators},excluded:{...saved.excluded}};}
 prediction.parse(predictedCountry);
 if(operator!==undefined&&operator!=='OR')throw Error('pagination_country_conflict');
 return{filters:{...saved.filters,country:{AU:'Australia'}},operators:{...saved.operators,country:'OR'},excluded:{...saved.excluded}};
}
