"use client";

import { Moon, Sun } from "lucide-react";

export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  function toggleTheme() {
    const theme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("acquired-theme", theme);
    } catch {
      // The theme still works when browser storage is unavailable.
    }
  }

  const labelClass = collapsed ? "lg:sr-only" : "";
  return (
    <button type="button" onClick={toggleTheme} className={`flex min-h-12 w-full items-center rounded-md px-3 text-sm text-[var(--muted)] hover:bg-[var(--panel-raised)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${collapsed ? "lg:justify-center lg:px-0" : ""}`}>
      <span className="theme-switch-to-light inline-flex items-center gap-3"><Sun size={20} aria-hidden="true" /><span className={labelClass}>Switch to light mode</span></span>
      <span className="theme-switch-to-dark items-center gap-3"><Moon size={20} aria-hidden="true" /><span className={labelClass}>Switch to dark mode</span></span>
    </button>
  );
}
