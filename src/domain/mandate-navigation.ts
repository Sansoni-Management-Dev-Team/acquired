export function mandateOutreachHref(mandateId: string, targetId?: string) {
  const path = `/mandates/${encodeURIComponent(mandateId)}/outreach`;
  return targetId ? `${path}?${new URLSearchParams({ targetId })}` : path;
}
export function mandateTabHref(mandateId: string, tab: string) {
  return tab === "outreach" ? mandateOutreachHref(mandateId) : `/mandates/${encodeURIComponent(mandateId)}?tab=${encodeURIComponent(tab)}`;
}
