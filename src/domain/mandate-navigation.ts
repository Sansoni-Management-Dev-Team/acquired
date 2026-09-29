export function mandateOutreachHref(mandateId: string, targetId?: string) {
  const path = `/mandates/${encodeURIComponent(mandateId)}/outreach`;
  return targetId ? `${path}?${new URLSearchParams({ targetId })}` : path;
}
export function mandateTabHref(mandateId: string, tab: string) {
  if (tab === "people") return `/mandates/${encodeURIComponent(mandateId)}/people`;
  if (tab === "sequences") return `/mandates/${encodeURIComponent(mandateId)}/outreach/sequences`;
  return tab === "outreach" ? mandateOutreachHref(mandateId) : `/mandates/${encodeURIComponent(mandateId)}?tab=${encodeURIComponent(tab)}`;
}
