"use client";

import { createContext, Suspense, useContext, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Building2, House, Settings, Plus, PanelLeftClose, PanelLeftOpen, Menu, FileText, ListFilter, Users, Mail } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { AcquisitionProgress } from "./acquisition-progress";
import { LegalLinks } from "./legal-page";
import { CampaignReplyAlerts } from "./campaign-reply-alerts";

import { useCachedSession,useSelectedMandate } from "./use-cached-mandates";
import {useMandateCache} from "@/lib/mandate-cache";
import {mandateIdFromPathname,mandateTabHref} from "@/domain/mandate-navigation";
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
  const selected=mandateIdFromPathname(pathname),entry=useMandateCache(state=>state.entry),session=useMandateCache(state=>state.session),requested=useRef<string|null>(null);
  useEffect(()=>{
    if(!selected||!session)return;
    const cache=useMandateCache.getState();cache.selectMandate(selected);
    const key=JSON.stringify([session.scope,selected]);
    if((entry?.scope!==session.scope||!entry.mandates.some(m=>m.id===selected))&&requested.current!==key){requested.current=key;void cache.refresh(true);}
  },[selected,entry,session]);
  const tab = pathname.endsWith("/agent") ? "agent" : pathname.endsWith("/people") ? "people" : pathname.endsWith("/outreach/sequences") ? "sequences" : pathname.endsWith("/companies") || ["targets", "search", "search enrich"].includes(searchParams.get("tab") || "") || pathname.includes("/targets/") ? "targets" : "brief";
  useEffect(() => {
    update(current => JSON.stringify({ ...JSON.parse(current), selected, tab }));
  }, [selected, tab, update]);
  return null;
}

function SessionWarmup() {
  useCachedSession();
  return null;
}

export function AppShell({ children,firmablePaused=false }: { children: React.ReactNode;firmablePaused?:boolean }) {
  const pathname = usePathname();
  const [sidebarJson, setSidebarJson] = useState('{"mandates":[],"tab":"brief"}');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebar: SidebarState = JSON.parse(sidebarJson);
  const cachedSelected=useSelectedMandate(),selected=mandateIdFromPathname(pathname)??cachedSelected;
  if (["/privacy", "/terms-of-service"].includes(pathname)) return <><div className="absolute right-4 top-4"><ThemeToggle /></div><main>{children}</main></>;
  if (["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/onboarding", "/auth/complete"].includes(pathname)) return <><div className="absolute right-4 top-4"><ThemeToggle /></div><main>{children}</main>{pathname !== "/sign-in" && <footer className="px-6 pb-8"><LegalLinks /></footer>}</>;

  return (
    <SidebarContext.Provider value={setSidebarJson}><SessionWarmup /><Suspense fallback={null}><SidebarRouteSync update={setSidebarJson} /></Suspense><div className={`min-h-screen lg:grid ${collapsed ? "lg:grid-cols-[80px_minmax(0,1fr)]" : "lg:grid-cols-[272px_minmax(0,1fr)]"}`}>
      <aside className={`border-b border-[var(--border)] bg-[var(--background)] p-4 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-b-0 lg:border-r ${collapsed ? "lg:px-3" : "lg:p-5"}`}>
        <div className={`flex items-center justify-between gap-2 ${collapsed ? "lg:flex-col" : ""}`}>
          <Link href="/" aria-label="Acquired — home" className="flex min-h-12 min-w-0 items-center gap-3">
            <Image src="/acquired-crown.png" width={42} height={42} alt="" className="size-10 shrink-0 object-contain theme-logo" priority />
            <span className={collapsed ? "lg:hidden" : ""}><strong className="block text-sm tracking-[.16em]">ACQUIRED</strong></span>
          </Link>
          <button aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} aria-controls="sidebar-navigation" onClick={() => setCollapsed(value => !value)} className="hidden size-11 shrink-0 items-center justify-center rounded-md hover:bg-[var(--panel-raised)] lg:flex">{collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}</button>
          <button aria-label={mobileOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileOpen} aria-controls="sidebar-navigation" onClick={() => setMobileOpen(value => !value)} className="flex size-12 items-center justify-center rounded-md lg:hidden"><Menu size={22} /></button>
        </div>
        <div id="sidebar-navigation" className={`${mobileOpen ? "block" : "hidden"} mt-5 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col`}>
          <nav aria-label="Mandates" className="space-y-1">
            <Link href="/" title="Home" aria-current={pathname === "/" ? "page" : undefined} onClick={() => setMobileOpen(false)} className={`flex min-h-12 items-center gap-3 rounded-md px-3 text-sm hover:bg-[var(--panel-raised)] ${pathname === "/" ? "bg-[var(--panel-raised)] font-semibold text-[var(--foreground)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"} ${collapsed ? "lg:justify-center lg:px-0" : ""}`}><House size={20} className="shrink-0" /><span className={collapsed ? "lg:sr-only" : ""}>Home</span></Link>
            <Link href="/mandates" title="All mandates" onClick={() => setMobileOpen(false)} className={`flex min-h-12 items-center gap-3 rounded-md px-3 text-sm text-[var(--muted)] hover:text-[var(--foreground)] ${collapsed ? "lg:justify-center lg:px-0" : ""}`}><Building2 size={20} className="shrink-0" /><span className={collapsed ? "lg:sr-only" : ""}>All mandates</span></Link>
            {collapsed && <Link href="/mandates/new" title="New mandate" onClick={() => setMobileOpen(false)} className="hidden min-h-12 items-center justify-center rounded-md text-[var(--muted)] hover:text-[var(--foreground)] lg:flex"><Plus size={20} /><span className="sr-only">New mandate</span></Link>}
          </nav>
          <nav aria-label="Mandate sections" className="mt-6 space-y-1 border-t border-[var(--border)] pt-4">
            {([["brief", "Brief", FileText], ["targets", "Companies", ListFilter], ["people", "People", Users], ["sequences", "Sequences", Mail]] as const).map(([tab, label, Icon]) => <Link key={tab} href={selected?mandateTabHref(selected,tab):`/mandates/select/${tab}`} aria-current={(selected && sidebar.tab === tab) || pathname === `/mandates/select/${tab}` ? "page" : undefined} title={label} onClick={() => setMobileOpen(false)} className={`flex min-h-12 items-center gap-3 rounded-md px-3 text-sm hover:bg-[var(--panel-raised)] ${(selected && sidebar.tab === tab) || pathname === `/mandates/select/${tab}` ? "bg-[var(--panel-raised)] font-semibold text-[var(--foreground)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"} ${collapsed ? "lg:justify-center lg:px-0" : ""}`}><Icon size={20} className="shrink-0" /><span className={collapsed ? "lg:sr-only" : ""}>{label}</span></Link>)}

          </nav>
          <nav aria-label="Account" className="mt-6 space-y-1 border-t border-[var(--border)] pt-4 lg:mt-auto">
            {firmablePaused&&<p role="status" className={`px-3 py-2 text-xs leading-relaxed text-[var(--muted)] ${collapsed?'lg:sr-only':''}`}><strong className="block font-medium">Firmable paused</strong>Saved research is available. New Firmable requests are disabled.</p>}
            <Link href="/settings" title="Settings" onClick={() => setMobileOpen(false)} className={`flex min-h-12 items-center gap-3 rounded-md px-3 text-sm text-[var(--muted)] hover:text-[var(--foreground)] ${collapsed ? "lg:justify-center lg:px-0" : ""}`}><Settings size={20} className="shrink-0" /><span className={collapsed ? "lg:sr-only" : ""}>Settings</span></Link>
            <ThemeToggle collapsed={collapsed} subtle />
          </nav>
        </div>
      </aside>
      <main className="min-w-0"><Suspense fallback={null}><AcquisitionProgress /></Suspense><CampaignReplyAlerts />{children}</main>
    </div></SidebarContext.Provider>
  );
}
