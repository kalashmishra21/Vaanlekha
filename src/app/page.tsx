import Link from "next/link";
import type { Metadata } from "next";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { DeferredSaathiCore } from "@/components/landing/deferred-saathi-core";
import { DeferredLandingVoiceDemo } from "@/components/landing/deferred-voice-demo";
import { LandingStory } from "@/components/landing/landing-story";
import { publicSiteUrl } from "@/lib/seo/site-url";
import "./stage12-landing.css";
import "./stage12-landing-overrides.css";
import "./stage22-landing.css";

const siteUrl = publicSiteUrl();
const publicDescription = "A multilingual voice-first AI copilot for Indian retailers. Manage inventory, khata, sales and orders through conversation with verified store actions.";

export const metadata: Metadata = {
  title: "DukaanSaathi AI | Voice-first store management for Indian retailers",
  description: publicDescription,
  alternates: siteUrl ? { canonical: siteUrl.href } : undefined,
  openGraph: {
    type: "website", locale: "en_IN",
    title: "DukaanSaathi AI — Your store, understood by voice",
    description: publicDescription, siteName: "DukaanSaathi AI",
    ...(siteUrl ? { url: siteUrl.href } : {}),
  },
  twitter: { card: "summary_large_image", title: "DukaanSaathi AI", description: publicDescription },
};

export default function Home() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "DukaanSaathi AI",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web browser",
    description: publicDescription,
    inLanguage: ["en-IN", "hi-IN"],
    ...(siteUrl ? { url: siteUrl.href } : {}),
  };
  return <div id="top" className="stage12-landing">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
    <a className="skip-link" href="#main">Skip to content</a>
    <SiteHeader />
    <main id="main">
      <section className="hero page-frame" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="hero-identity">Voice, shaped for Indian commerce.</p>
          <h1 id="hero-title">Your store,<br /><em>understood.</em></h1>
          <p className="hero-description">Inventory, khata and sales come into focus when the work begins with your voice.</p>
          <div className="hero-actions">
            <Link className="action-primary" href="/signin?mode=signup">Create your account <ArrowUpRight size={18} aria-hidden="true" /></Link>
            <a className="action-text" href="#story">See how it works <ArrowDown size={17} aria-hidden="true" /></a>
          </div>
          <p className="hero-honesty"><span aria-hidden="true" /> Simulated visual sequence · no microphone or store action</p>
        </div>
        <DeferredSaathiCore />
      </section>

      <LandingStory />

      <section className="studio page-frame" id="studio" aria-labelledby="studio-title">
        <div className="studio-heading"><h2 id="studio-title">A studio for the<br /><em>whole shop.</em></h2><p>One place to ask, check and act. These examples illustrate the workspace; your signed-in store shows its own records.</p></div>
        <div className="bento">
          <article className="bento-cell bento-command">
            <div className="bento-top"><span>ASSISTANT / COMMAND CENTER</span><span className="signal"><i /> Ready to help</span></div>
            <div className="command-content"><p className="command-prompt">“Sharma ji ka kitna udhaar hai?”</p><div className="command-line"><span className="command-symbol" aria-hidden="true">₹</span><div><strong>Khata balance</strong><small>Illustrative ledger result</small></div><b>₹770</b></div></div>
            <div className="command-compose"><span>Ask Saathi about your store...</span><ArrowUpRight size={18} aria-hidden="true" /></div>
          </article>
          <article className="bento-cell bento-inventory">
            <div className="bento-top"><span>INVENTORY / ILLUSTRATIVE STOCK</span><span>03 ITEMS</span></div>
            <h3>Know what<br /><em>needs attention.</em></h3>
            <div className="stock-rows"><div><span>Maggi</span><span>48 in stock</span><i className="stock-high" /></div><div><span>Amul Milk</span><span>Low · 6 left</span><i className="stock-low" /></div><div><span>Parle-G</span><span>90 in stock</span><i className="stock-full" /></div></div>
          </article>
          <article className="bento-cell bento-ledger">
            <div className="bento-top"><span>KHATA / ILLUSTRATIVE ACCOUNT</span><span>SHARMA JI</span></div><div className="ledger-mark" aria-hidden="true"><span>₹</span></div>
            <h3>Every entry<br />accounted for.</h3>
            <div className="ledger-lines"><div><span>Gave · opening udhaar</span><b>+₹1,000</b></div><div><span>Received · repayment</span><b>−₹230</b></div><div className="ledger-total"><span>Example outstanding</span><strong>₹770</strong></div></div>
          </article>
          <article className="bento-cell bento-sales">
            <div className="bento-top"><span>SALES / ILLUSTRATIVE DAY</span><span>3 SALES</span></div><div className="sales-total"><small>Example daily total</small><strong>₹1,460</strong></div>
            <div className="sales-visual" aria-hidden="true">{[42, 64, 48, 79, 56, 91, 72].map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}</div>
            <p>One glance at the day, grounded in recorded sales when signed in.</p>
          </article>
        </div>
      </section>

      <section id="voice-demo" className="landing-demo-section" aria-labelledby="demo-title">
        <div className="landing-frame landing-demo-grid">
          <div className="landing-demo-intro"><p className="landing-eyebrow">REAL AUDIO · MOCK UNDERSTANDING</p><h2 id="demo-title">Hear the words.<br /><em>See the intent.</em></h2><p>Play one of four locally served Gnani voice samples. The structured results shown here are previews; this page never changes store data.</p><Link className="landing-text-link dark" href="/signin?mode=signup">Try the assistant <ArrowUpRight size={18} aria-hidden="true" /></Link></div>
          <DeferredLandingVoiceDemo />
        </div>
      </section>

      <section className="closing"><div className="page-frame closing-inner"><span className="closing-mark" aria-hidden="true">D</span><div><h2>Commerce moves.<br /><em>Saathi keeps pace.</em></h2><p>Create an account to work with your own private store records.</p></div><Link href="/signin?mode=signup" aria-label="Create your account"><ArrowUpRight size={22} aria-hidden="true" /></Link></div></section>
    </main>
    <footer className="site-footer page-frame"><span>DukaanSaathi AI</span><span>Voice-first tools · trusted store data</span></footer>
  </div>;
}
