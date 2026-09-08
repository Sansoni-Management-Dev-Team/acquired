import Link from "next/link";

const tabs = [
  ["brief", "Brief"],
  ["targets", "Targets"],
  ["pipeline", "Pipeline"],
  ["outreach", "Outreach"],
] as const;

export function mandateTabHref(mandateId: string, tab: string) {
  return tab === "outreach" ? `/outreach?mandateId=${mandateId}` : `/mandates/${mandateId}?tab=${tab}`;
}

export function MandateTabs({ mandateId, activeTab }: { mandateId: string; activeTab: string }) {
  return <nav aria-label="Mandate sections" className="flex gap-1 overflow-x-auto border-b border-[var(--border)]">
    {tabs.map(([tab, label]) => <Link
      key={tab}
      href={mandateTabHref(mandateId, tab)}
      aria-current={activeTab === tab ? "page" : undefined}
      className={`flex min-h-12 shrink-0 items-center border-b-2 px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] ${activeTab === tab ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[var(--muted)] hover:border-[var(--border)] hover:text-white"}`}
    >{label}</Link>)}
  </nav>;
}
