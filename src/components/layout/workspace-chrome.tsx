"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { AudioLines, Menu, MessageCircle, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { BrandLockup, BrandMark } from "./brand";
import { WorkspaceNav } from "./workspace-nav";
import { ProfileControl } from "./profile-control";
import { AppearanceControl } from "./appearance-control";

const AssistantWorkspace = dynamic(() => import("@/components/assistant/assistant-workspace").then((module) => module.AssistantWorkspace),
  { loading: () => <div className="saathi-drawer-loading" role="status">Opening Vaani…</div> });

export function WorkspaceChrome({ children, shopName, status, description, connected, providerMode, reasonerMode, voiceAvailable }: {
  children: ReactNode; shopName: string; status: string; description: string;
  connected: boolean; providerMode: "mock" | "gnani"; reasonerMode: "mock" | "openrouter" | "gemini"; voiceAvailable: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const expanded = pathname === "/app/assistant";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [assistantLoaded, setAssistantLoaded] = useState(expanded);
  const assistantVisible = expanded || drawerOpen;
  const mobile = useRef<HTMLDialogElement>(null);
  const drawer = useRef<HTMLDivElement>(null);
  const floatingTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const frame = requestAnimationFrame(() => { setAssistantLoaded(true); setDrawerOpen(false); });
    return () => cancelAnimationFrame(frame);
  }, [expanded]);
  useEffect(() => {
    if (!drawerOpen) return;
    const returnFocus = floatingTrigger.current;
    const focusFrame = requestAnimationFrame(() => drawer.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus());
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setDrawerOpen(false); return; }
      if (event.key !== "Tab" || !drawer.current) return;
      const candidates = [...drawer.current.querySelectorAll<HTMLElement>("button:not([disabled]),a[href],input:not([disabled]),select:not([disabled])")]
        .filter((element) => element.offsetParent !== null);
      if (!candidates.length) return;
      const first = candidates[0]; const last = candidates[candidates.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", close);
    return () => { cancelAnimationFrame(focusFrame); window.removeEventListener("keydown", close); returnFocus?.focus(); };
  }, [drawerOpen]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try { setCollapsed(localStorage.getItem("dukaansaathi-sidebar") === "collapsed"); } catch { /* Default expanded. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    document.documentElement.dataset.sidebar = next ? "collapsed" : "expanded";
    try { localStorage.setItem("dukaansaathi-sidebar", next ? "collapsed" : "expanded"); } catch { /* This session still updates. */ }
  }

  const sidebar = (mobileView: boolean) => <>
    <div className="workspace-sidebar-head"><BrandLockup href="/app" className="workspace-brand" />
      {mobileView ? <button type="button" className="sidebar-icon-button" aria-label="Close navigation" onClick={() => mobile.current?.close()}><X size={19} /></button>
        : <button type="button" className="sidebar-icon-button sidebar-collapse" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} onClick={toggleSidebar}>{collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}</button>}
    </div>
    <WorkspaceNav onNavigate={mobileView ? () => mobile.current?.close() : undefined} />
    <div className="workspace-sidebar-bottom"><span className="workspace-voice-glyph"><AudioLines size={20} strokeWidth={1.5} aria-hidden="true" /></span><div><strong>{status}</strong><p>{description}</p></div></div>
  </>;

  return <div className="workspace-shell">
    <aside className="workspace-sidebar" aria-label="Workspace sidebar">{sidebar(false)}</aside>
    <div className="workspace-content">
      <header className="workspace-topbar">
        <div className="workspace-topbar-location"><button type="button" className="mobile-menu-button" aria-label="Open navigation" onClick={() => mobile.current?.showModal()}><Menu size={21} /></button><span className="workspace-mobile-symbol"><BrandMark size={26} /></span><span className="workspace-topbar-mark" /><span className="workspace-topbar-shop">{shopName}</span><span className="workspace-topbar-separator">/</span><span className="workspace-topbar-secondary">STORE WORKSPACE</span></div>
        <div className="workspace-topbar-controls"><AppearanceControl placement="workspace" /><ProfileControl /></div>
      </header>
      <main className="workspace-main" hidden={expanded}>{children}</main>
      {(assistantLoaded || expanded) && <div ref={drawer} className={expanded ? "shared-assistant-full" : "shared-assistant-drawer"} hidden={!assistantVisible}
        role={expanded ? undefined : "dialog"} aria-modal={expanded ? undefined : true} aria-label="Vaani assistant">
        <AssistantWorkspace connected={connected} providerMode={providerMode} reasonerMode={reasonerMode} voiceAvailable={voiceAvailable}
          expanded={expanded} onClose={() => setDrawerOpen(false)} />
      </div>}
    </div>
    {!expanded && !drawerOpen && <button ref={floatingTrigger} type="button" className="saathi-float-trigger" onClick={() => { setAssistantLoaded(true); setDrawerOpen(true); }}
      aria-label="Open Vaani assistant"><MessageCircle size={22} aria-hidden="true" /><span>Ask Vaani</span></button>}
    {drawerOpen && !expanded && <button type="button" className="saathi-drawer-scrim" aria-label="Close Vaani assistant" onClick={() => setDrawerOpen(false)} />}
    <dialog ref={mobile} className="mobile-nav-dialog" aria-label="Workspace navigation" onClick={(event) => { if (event.target === mobile.current) mobile.current.close(); }}>
      <div className="mobile-nav-content">{sidebar(true)}</div>
    </dialog>
  </div>;
}
