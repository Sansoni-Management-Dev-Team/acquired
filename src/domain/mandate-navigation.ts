export function mandateCompaniesHref(mandateId: string, searchParams?: URLSearchParams) {
  const query = new URLSearchParams(searchParams);
  query.delete('tab');
  const suffix = query.toString();
  return `/mandates/${encodeURIComponent(mandateId)}/companies${suffix ? `?${suffix}` : ''}`;
}

export function mandatePeopleHref(mandateId: string) {
  return `/mandates/${encodeURIComponent(mandateId)}/people`;
}
export function mandateTabHref(mandateId: string, tab: string) {
  if (["targets", "companies", "coverage", "discover", "pipeline"].includes(tab)) return mandateCompaniesHref(mandateId);
  if (tab === "people" || tab === "outreach") return mandatePeopleHref(mandateId);
  if (tab === "sequences") return `/mandates/${encodeURIComponent(mandateId)}/outreach/sequences`;
  return `/mandates/${encodeURIComponent(mandateId)}?tab=${encodeURIComponent(tab)}`;
}

export function mandateIdFromPathname(pathname:string){
 const id=pathname.split("?")[0].match(/^\/mandates\/([^/]+)(?:\/|$)/)?.[1];
 return id&&id!=="new"&&id!=="select"?id:undefined;
}
