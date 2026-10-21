import {briefSchema,criterionDefinitions} from '@/domain/acquisition';
import {readableStoredBrief} from '@/domain/stored-brief';
/** Provider discovery constraints come from the saved structured fields. The
 * retained narrative may predate an edit and may contain private buyer facts;
 * it is deliberately not merged into a structured query. Historical mandates
 * without a structured brief retain their existing ordinary query.
 *
 * Ordinary research explicitly requested by a human may explore provisional
 * criteria. That search intent never confirms the brief, qualifies a company
 * or grants contact/disclosure/sending authority. Native reviewed work retains
 * its confirmed-only interpretation. The caller freezes this distinction on
 * the saved root rather than accepting it from a browser search request. */
export function reviewedCompanyQuery(mandate:{naturalLanguage:string;filters:unknown},options:{requireReviewedBrief?:boolean;intent?:'reviewed'|'exploratory'}={}):string{
 const filters=mandate.filters as {brief?:unknown}|null;
 if(!filters?.brief){if(options.requireReviewedBrief)throw Error('Native discovery requires its saved reviewed brief');return mandate.naturalLanguage;}
 const brief=briefSchema.parse(readableStoredBrief(filters.brief));
 const fields=criterionDefinitions.filter(([, ,phase])=>phase==='discovery');
 const exploratory=options.intent==='exploratory'&&!options.requireReviewedBrief;
 const lines=fields.map(([key,label])=>{
  const value=brief.criteria.find(c=>c.key===key)!;
  if(value.state==='unknown'||(!value.confirmed&&!exploratory))return `${label}: unknown (do not infer a constraint)`;
  if(value.state==='unrestricted')return `${label}: unrestricted`;
  // National is the application's all-Australian-states scope. Preserve that
  // country in the provider query instead of asking its model to infer it.
  const constraint=key==='geography'&&/^national$/i.test(value.value.trim())?'Australia (National: all states and territories)':value.value.trim();
  return `${label} (${value.importance}${!value.confirmed?', provisional search intent':''}): ${constraint}`;
 });
 return [exploratory?'Find companies using these discovery criteria. Provisional values express search intent only; company qualification still requires review.':'Find companies using these reviewed discovery criteria.',...lines].join('\n');
}
