"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function DetailTooltip({ children, content }: { children: ReactNode; content: ReactNode }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    window.addEventListener("resize", close);
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest('[role="tooltip"]')) close();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [position]);

  function keepOpen() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }

  function open() {
    keepOpen();
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(384, window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 20;
    const above = rect.top - 20;
    const maxHeight = Math.min(320, Math.max(below, above));
    setPosition({
      width,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: below >= maxHeight ? rect.bottom + 8 : Math.max(12, rect.top - maxHeight - 8),
      maxHeight,
    });
  }

  function closeSoon() {
    keepOpen();
    closeTimer.current = setTimeout(() => setPosition(null), 150);
  }

  return <span className="inline-block" onKeyDown={event => {
    if (event.key === "Escape") { keepOpen(); setPosition(null); }
  }}>
    <button ref={trigger} type="button" aria-describedby={position ? id : undefined}
      className="cursor-help text-left outline-offset-4"
      onMouseEnter={open} onMouseLeave={closeSoon} onFocus={open} onBlur={closeSoon}
      onClick={open}>{children}</button>
    {position && createPortal(<div id={id} role="tooltip"
      className="fixed z-50 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--panel)] p-3 text-xs text-[var(--foreground)] shadow-lg"
      style={position} onMouseEnter={keepOpen} onMouseLeave={closeSoon}
      onFocusCapture={keepOpen} onBlurCapture={closeSoon}>{content}</div>, document.body)}
  </span>;
}
