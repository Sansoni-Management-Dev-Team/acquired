type Data=Record<string,unknown>;
export const companyFieldObject=(value:unknown):Data=>value&&typeof value==='object'&&!Array.isArray(value)?value as Data:{};
/** Original browser payload and service projections describe the same observation. */
export function firmableCompanyPayload(input:Data):Data{return {...companyFieldObject(input.browserResponse),...input};}
export function companyFieldStrings(value:unknown):string[]{
 const values=typeof value==='string'?[value]:Array.isArray(value)?value:Object.values(companyFieldObject(value));
 return [...new Set(values.flatMap(v=>typeof v==='string'&&v.trim()?[v.trim()]:v&&typeof v==='object'?[companyFieldObject(v).value,companyFieldObject(v).email,companyFieldObject(v).number,companyFieldObject(v).name].filter((s):s is string=>typeof s==='string'&&Boolean(s.trim())).slice(0,1).map(s=>s.trim()):[]))];
}
function companyContacts(value:unknown,kind:'email'|'phone'){
 const structured=companyFieldObject(value);const direct=structured.value??structured.email??structured.number;
 return companyFieldStrings(direct??value).filter(item=>kind==='email'?/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item):(item.match(/\d/g)||[]).length>=6);
}
const text=(value:unknown)=>typeof value==='string'&&value.trim()?value.trim():undefined;
const numeric=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&/^\d+$/.test(value.trim())?Number(value):undefined;
const labels=(value:unknown)=>text(value)||companyFieldStrings(value).join(', ')||undefined;
/** Projection contract: unknown/new fields stay in rawResponse; known data is queryable. */
export const firmableCompanyFieldCatalogue={
 id:'firmableId',name:'name',company_name:'name',website:'website',fqdn:'domain',description:'description',tagline:'tagline',company_type:'companyType',company_size:'companySize',revenue:'revenueBand',employee_count:'employeeCount',year_founded:'yearFounded',industries:'industries',keywords:'keywords',hq_location:'headquarters',hq_country:'headquartersCountry',states:'states',locations:'locations',industry_codes:'industryCodes',abn:'abn',acn:'acn',abn_operation_status:'abnStatus',linkedin:'linkedin',social_media:'socialMedia',available_people_count:'availablePeopleCount',people_summary:'peopleSummary',company_emails:'companyEmails',company_phones:'companyPhones',company_details:'companyDetails',region:'regions',profiles:'profiles',logo:'logo',slug:'slug',search_rank:'searchRank',nextGen:'nextGen',browserResponse:'rawResponse',revenue_currency:'rawResponse',revenue_period:'rawResponse',au_employee_count:'rawResponse',websiteResearch:'rawResponse',website_address:'rawResponse',metadata:'rawResponse',secondary_industries:'secondaryIndustries',firmable_verified:'firmableVerified',org_registers:'organizationRegisters',
} as const;
export function projectFirmableCompanyFields(input:Data,fallbackId:string,capturedAt:string){
 const raw=firmableCompanyPayload(input),regions=companyFieldObject(raw.region),au=companyFieldObject(regions.AU),details=companyFieldObject(raw.company_details),regional=Object.keys(au).length?au:details.country==='AU'?details:{};
 const identifiers=companyFieldObject(regional.business_identifiers),industryCodes=companyFieldObject(raw.industry_codes);
 const identifier=(key:string)=>text(companyFieldObject(identifiers[key]).value)||text(industryCodes[key])||text(raw[key]);
 const socialMedia={...companyFieldObject(raw.social_media),...companyFieldObject(regional.social_media)};
 const regionEmails=regional.emails,regionPhones=regional.phones;
 const fieldCoverage=Object.entries(raw).map(([sourceField])=>({sourceField,destination:firmableCompanyFieldCatalogue[sourceField as keyof typeof firmableCompanyFieldCatalogue]||'rawResponse',projection:sourceField in firmableCompanyFieldCatalogue?'mapped':'retained'}));
 return{
  firmableId:String(raw.id||fallbackId),capturedAt,rawResponse:input,name:text(raw.name)||text(raw.company_name),website:text(raw.website)||text(regional.website),domain:text(raw.fqdn)||text(regional.fqdn),description:text(raw.description),tagline:text(raw.tagline),companyType:labels(raw.company_type),companySize:labels(raw.company_size),revenueBand:labels(raw.revenue),employeeCount:numeric(raw.employee_count),yearFounded:numeric(raw.year_founded)??numeric(regional.year_founded),industries:companyFieldStrings(raw.industries),keywords:companyFieldStrings(raw.keywords),headquarters:text(raw.hq_location),headquartersCountry:text(raw.hq_country),states:companyFieldStrings(raw.states),locations:companyFieldStrings(raw.locations??regional.locations),abn:identifier('abn'),acn:identifier('acn'),anzsic:text(industryCodes.anzsic),abnStatus:text(raw.abn_operation_status)||text(companyFieldObject(identifiers.abn).status),linkedin:text(raw.linkedin)||text(socialMedia.linkedin),availablePeopleCount:numeric(raw.available_people_count),peopleSummary:raw.people_summary&&typeof raw.people_summary==='object'?companyFieldObject(raw.people_summary):undefined,companyEmails:companyContacts(regionEmails??raw.company_emails,'email'),companyPhones:companyContacts(regionPhones??raw.company_phones,'phone'),companyDetails:{...regional,...details,country:details.country||(Object.keys(regional).length?'AU':undefined),address:details.address??regional.address,locations:details.locations??regional.locations},industryCodes,socialMedia,regions,organizationRegisters:companyFieldObject(regional.org_registers??raw.org_registers),secondaryIndustries:companyFieldStrings(raw.secondary_industries),firmableVerified:typeof raw.firmable_verified==='boolean'?raw.firmable_verified:undefined,providerFields:Object.fromEntries(Object.entries(raw).filter(([key])=>!(key in firmableCompanyFieldCatalogue))),profiles:companyFieldObject(raw.profiles),logo:raw.logo,slug:text(raw.slug),searchRank:numeric(raw.search_rank),nextGen:raw.nextGen,fieldCoverage,
 };
}
