"use client";

import { createContext, Suspense, useContext, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, House, Settings, Plus, PanelLeftClose, PanelLeftOpen, Menu, FileText, ListFilter, Users, Mail } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { AcquisitionProgress } from "./acquisition-progress";
import { LegalLinks } from "./legal-page";

import { mandateTabHref } from "@/domain/mandate-navigation";
type SidebarState = { mandates: { id: string; name: string }[]; selected?: string; tab: string };
const SidebarContext = createContext<(value: string) => void>(() => {});
export function SidebarRegistration({ value }: { value: SidebarState }) {
  const publish = useContext(SidebarContext);
  const serialized = JSON.stringify(value);
  useEffect(() => { publish(serialized); }, [publish, serialized]);
  return null;
}

function SidebarRouteSync({ update }: { update: React.Dispatch<React.SetStateAction<string>> }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeId = pathname.match(/^\/mandates\/([^/]+)(?:\/|$)/)?.[1];
  const selected = routeId && routeId !== "new" ? routeId : undefined;
  const tab = pathname.endsWith("/people") ? "people" : pathname.endsWith("/outreach/sequences") ? "sequences" : searchParams.get("tab") === "targets" || pathname.includes("/targets/") ? "targets" : "brief";
  useEffect(() => {
    update(current => JSON.stringify({ ...JSON.parse(current), selected, tab }));
  }, [selected, tab, update]);
  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarJson, setSidebarJson] = useState('{"mandates":[],"tab":"brief"}');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebar: SidebarState = JSON.parse(sidebarJson);
  if (["/privacy", "/terms-of-service"].includes(pathname)) return <><div className="absolute right-4 top-4"><ThemeToggle /></div><main>{children}</main></>;
  if (["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/onboarding", "/auth/complete"].includes(pathname)) return <><div className="absolute right-4 top-4"><ThemeToggle /></div><main>{children}</main>{pathname !== "/sign-in" && <footer className="px-6 pb-8"><LegalLinks /></footer>}</>;

  return (
    <SidebarContext.Provider value={setSidebarJson}><Suspense fallback={null}><SidebarRouteSync update={setSidebarJson} /></Suspense><div className={`min-h-screen lg:grid ${collapsed ? "lg:grid-cols-[80px_minmax(0,1fr)]" : "lg:grid-cols-[272px_minmax(0,1fr)]"}`}>
      <aside className={`border-b border-[var(--border)] bg-[var(--background)] p-4 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-b-0 lg:border-r ${collapsed ? "lg:px-3" : "lg:p-5"}`}>
        <div className={`flex items-center justify-between gap-2 ${collapsed ? "lg:flex-col" : ""}`}>
          <Link href="/" aria-label="Acquired — home" className="flex min-h-12 min-w-0 items-center gap-3">
            <Image src="/acquired-crown.png" width={42} height={42} alt="" className="size-10 shrink-0 object-contain theme-logo" priority />
            <span className={collapsed ? "lg:hidden" : ""}><strong className="block text-sm tracking-[.16em]">ACQUIRED</strong></span>
          </Link>
          <button aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} aria-controls="desktop-mandate-selector" onClick={() => setCollapsed(value => !value)} className="hidden size-11 shrink-0 items-center justify-center rounded-md hover:bg-[var(--panel-raised)] lg:flex">{collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}</button>
          <button aria-label={mobileOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileOpen} aria-controls="sidebar-navigation" onClick={() => setMobileOpen(value => !value)} className="flex size-12 items-center justify-center rounded-md lg:hidden"><Menu size={22} /></button>
        </div>
        <div id="sidebar-navigation" className={`${mobileOpen ? "block" : "hidden"} mt-5 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col`}>
          <div id="desktop-mandate-selector" className={collapsed ? "lg:hidden" : ""}>
            <label className="sr-only" htmlFor="mandate-selector">Select a mandate</label>
              <select id="mandate-selector" aria-label="Active mandate" value={sidebar.selected || ""} onChange={e => { router.push(e.target.value === "__new__" ? "/mandates/new" : mandateTabHref(e.target.value, sidebar.tab)); setMobileOpen(false); }} className="min-h-12 w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--panel-raised)] px-3 text-sm text-[var(--foreground)]">
                <option value="" disabled>Select a mandate</option>
                {sidebar.mandates.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                <option value="__new__">+ Create new mandate</option>
              </select>
          </div>
          <nav aria-label="Mandates" className="mt-3 space-y-1">
            <Link href="/" title="Home" aria-current={pathname === "/" ? "page" : undefined} onClick={() => setMobileOpen(false)} className={`flex min-h-12 items-center gap-3 rounded-md px-3 text-sm hover:bg-[var(--panel-raised)] ${pathname === "/" ? "bg-[var(--panel-raised)] font-semibold text-[var(--foreground)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"} ${collapsed ? "lg:justify-center lg:px-0" : ""}`}><House size={20} className="shrink-0" /><span className={collapsed ? "lg:sr-only" : ""}>Home</span></Link>
            <Link href="/mandates" title="All mandates" onClick={() => setMobileOpen(false)} className={`flex min-h-12 items-center gap-3 rounded-md px-3 text-sm text-[var(--muted)] hover:text-[var(--foreground)] ${collapsed ? "lg:justify-center lg:px-0" : ""}`}><Building2 size={20} className="shrink-0" /><span className={collapsed ? "lg:sr-only" : ""}>All mandates</span></Link>
            {collapsed && <Link href="/mandates/new" title="New mandate" onClick={() => setMobileOpen(false)} className="hidden min-h-12 items-center justify-center rounded-md text-[var(--muted)] hover:text-[var(--foreground)] lg:flex"><Plus size={20} /><span className="sr-only">New mandate</span></Link>}
          </nav>
          {sidebar.selected && <nav aria-label="Mandate sections" className="mt-6 space-y-1 border-t border-[var(--border)] pt-4">
            {([["brief", "Brief", FileText], ["targets", "Companies", ListFilter], ["people", "People", Users], ["sequences", "Sequences", Mail]] as const).map(([tab, label, Icon]) => <Link key={tab} href={mandateTabHref(sidebar.selected!, tab)} aria-current={sidebar.tab === tab ? "page" : undefined} title={label} onClick={() => setMobileOpen(false)} className={`flex min-h-12 items-center gap-3 rounded-md px-3 text-sm hover:bg-[var(--panel-raised)] ${sidebar.tab === tab ? "bg-[var(--panel-raised)] font-semibold text-[var(--foreground)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"} ${collapsed ? "lg:justify-center lg:px-0" : ""}`}><Icon size={20} className="shrink-0" /><span className={collapsed ? "lg:sr-only" : ""}>{label}</span></Link>)}

          </nav>}
          <nav aria-label="Account" className="mt-6 space-y-1 border-t border-[var(--border)] pt-4 lg:mt-auto">
            <Link href="/settings" title="Settings" onClick={() => setMobileOpen(false)} className={`flex min-h-12 items-center gap-3 rounded-md px-3 text-sm text-[var(--muted)] hover:text-[var(--foreground)] ${collapsed ? "lg:justify-center lg:px-0" : ""}`}><Settings size={20} className="shrink-0" /><span className={collapsed ? "lg:sr-only" : ""}>Settings</span></Link>
            <ThemeToggle collapsed={collapsed} subtle />
          </nav>
        </div>
      </aside>
      <main className="min-w-0"><Suspense fallback={null}><AcquisitionProgress /></Suspense>{children}</main>
    </div></SidebarContext.Provider>
  );
}
