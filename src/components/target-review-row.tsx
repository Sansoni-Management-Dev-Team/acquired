import type { ReactNode } from "react";

export function TargetReviewRow({ companyName, onReview, children }: {
  companyName: string; onReview: () => void; children: ReactNode;
}) {
  return <tr
    tabIndex={0}
    aria-label={`Review ${companyName}`}
    className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--panel)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]"
    onClick={event => {
      const target = event.target as HTMLElement;
      // Preserve controls and disclosures, including clicks on their nested icons.
      if (target.closest("a, button, input, select, textarea, label, details, [role='button'], [contenteditable='true']")) return;
      if (event.currentTarget.ownerDocument.getSelection()?.isCollapsed === false) return;
      onReview();
    }}
    onKeyDown={event => {
      if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      onReview();
    }}
  >{children}</tr>;
}
