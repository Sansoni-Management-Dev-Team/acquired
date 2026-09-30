export function mandatePeopleHref(mandateId: string) {
  return `/mandates/${encodeURIComponent(mandateId)}/people`;
}
export function mandateTabHref(mandateId: string, tab: string) {
  if (tab === "people" || tab === "outreach") return mandatePeopleHref(mandateId);
  if (tab === "sequences") return `/mandates/${encodeURIComponent(mandateId)}/outreach/sequences`;
  return `/mandates/${encodeURIComponent(mandateId)}?tab=${encodeURIComponent(tab)}`;
}
