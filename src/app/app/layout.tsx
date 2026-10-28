import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { WorkspaceChrome } from "@/components/layout/workspace-chrome";
import { BrandLockup } from "@/components/layout/brand";
import { getShopContext } from "@/server/data/context";
import { readProviderConfig } from "@/lib/env/config";

export const metadata: Metadata = { title: "Workspace | Vaanlekha", robots: { index: false, follow: false } };

function WorkspaceLoadingShell() {
  return <div className="workspace-shell" aria-busy="true">
    <aside className="workspace-sidebar">
      <BrandLockup href="/app" className="workspace-brand" />
    </aside>
    <div className="workspace-content"><header className="workspace-topbar"><div><span className="workspace-topbar-mark" /><span>OPENING WORKSPACE</span></div></header>
      <main className="workspace-main"><div className="workspace-page-loading" role="status"><span className="workspace-loading-line" /><strong>Opening your store…</strong><p>Checking your session and shop records.</p></div></main>
    </div>
  </div>;
}

async function WorkspaceLayoutData({ children }: Readonly<{ children: React.ReactNode }>) {
  const context = await getShopContext();
  if (context.kind === "signed-out") redirect("/signin");
  const connected = context.kind === "ready";
  const config = readProviderConfig();
  const reasonerDescription = config.AI_REASONER === "gemini"
    ? "Store data is live. Gemini reasoning is configured with OpenRouter fallback."
    : config.AI_REASONER === "openrouter"
      ? "Store data is live. OpenRouter reasoning is configured."
      : "Store data is live. Reasoning uses the mock provider.";
  return (
    <WorkspaceChrome shopName={connected ? context.shop.name : "Workspace setup"}
      connected={connected} providerMode={config.AI_PROVIDER} reasonerMode={config.AI_REASONER} voiceAvailable={Boolean(process.env.GNANI_API_KEY)}
      status={connected ? "Store connected" : "Vaani is ready"}
      description={connected ? reasonerDescription : "Connect a shop to enable trusted business actions."}>
      {children}
    </WorkspaceChrome>
  );
}

export default function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <Suspense fallback={<WorkspaceLoadingShell />}><WorkspaceLayoutData>{children}</WorkspaceLayoutData></Suspense>;
}
