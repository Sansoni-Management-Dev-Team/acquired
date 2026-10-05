"use client";

import { usePathname, useSearchParams } from "next/navigation";

const stages = ["Brief", "Companies", "People", "Outreach"] as const;

export function AcquisitionProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isMandate = /^\/mandates\/[^/]+(?:\/|$)/.test(pathname);
  if (pathname !== "/" && !isMandate && pathname !== "/preview/outreach") return null;

  const current = pathname.includes("/outreach") ? 3
    : pathname.endsWith("/people") ? 2
    : searchParams.get("tab") === "targets" || pathname.includes("/targets/") ? 1
    : 0;

  return (
    <nav aria-label="Acquisition progress" className="mx-5 mt-5 flex flex-col gap-3 border-b border-[var(--border)] px-1 py-3 sm:mx-8 sm:mt-6 xl:flex-row xl:items-center xl:justify-between">
      <p className="shrink-0 text-xs font-semibold text-[var(--foreground)]">Stage {current + 1} of 4 · {stages[current]}</p>
      <ol className="flex items-center">
        {stages.map((label, index) => (
          <li key={label} aria-current={index === current ? "step" : undefined} className={`flex items-center gap-1 text-[10px] font-semibold sm:gap-2 sm:text-xs ${index === current ? "text-[var(--foreground)]" : "text-[var(--muted)]"}`}>
            {index > 0 && <span aria-hidden="true" className="mx-1 h-px w-2 bg-[var(--border)] sm:mx-3 sm:w-8" />}
            <span aria-hidden="true" className={`flex size-[22px] shrink-0 items-center justify-center rounded-full text-[10px] ${index === current ? "bg-[var(--accent)] text-[var(--on-accent)]" : "bg-[var(--panel-raised)] text-[var(--muted)]"}`}>{index + 1}</span>
            <span><span className="sr-only">Step {index + 1}: </span>{label}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
