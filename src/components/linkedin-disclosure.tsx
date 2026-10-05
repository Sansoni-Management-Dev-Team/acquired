import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function LinkedInDisclosure({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <details className="group/linkedin border-t border-[var(--border)]">
    <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)] [&::-webkit-details-marker]:hidden">
      <span className="font-medium">{title}</span>{hint && <span className="ml-auto text-xs text-[var(--muted)]">{hint}</span>}
      <ChevronDown size={16} aria-hidden="true" className={`${hint ? "" : "ml-auto"} shrink-0 transition-transform group-open/linkedin:rotate-180`} />
    </summary>
    <div className="pb-4">{children}</div>
  </details>;
}
