import Link from "next/link";
import type { Metadata } from "next";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { DeferredVaaniCore } from "@/components/landing/deferred-vaani-core";
import { DeferredLandingVoiceDemo } from "@/components/landing/deferred-voice-demo";
import { LandingStory } from "@/components/landing/landing-story";
import { publicSiteUrl } from "@/lib/seo/site-url";
import { cookies } from "next/headers";
import { normalizeLocale, translate } from "@/lib/i18n";
import "./stage12-landing.css";
import "./stage12-landing-overrides.css";
import "./stage22-landing.css";

const siteUrl = publicSiteUrl();
const publicDescription = "A multilingual voice-first AI copilot for Indian retailers. Manage inventory, khata, sales and orders through conversation with verified store actions.";

export const metadata: Metadata = {
  title: "Vaanlekha | Voice-first store management for Indian retailers",
  description: publicDescription,
  alternates: siteUrl ? { canonical: siteUrl.href } : undefined,
  openGraph: {
    type: "website", locale: "en_IN",
    title: "Vaanlekha — Your store, understood by voice",
    description: publicDescription, siteName: "Vaanlekha",
    ...(siteUrl ? { url: siteUrl.href } : {}),
  },
  twitter: { card: "summary_large_image", title: "Vaanlekha", description: publicDescription },
};

export default async function Home() {
  const cookieStore = await cookies();
  const t = (source: string) => translate(normalizeLocale(cookieStore.get("vaanlekha-language")?.value), source);
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Vaanlekha",
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
          <p className="hero-identity">{t("Voice, shaped for Indian commerce.")}</p>
          <h1 id="hero-title">{t("Your store,")}<br /><em>{t("understood.")}</em></h1>
          <p className="hero-description">{t("Inventory, khata and sales come into focus when the work begins with your voice.")}</p>
          <div className="hero-actions">
            <Link className="action-primary" href="/signin?mode=signup">{t("Create your account")} <ArrowUpRight size={18} aria-hidden="true" /></Link>
            <a className="action-text" href="#story">{t("See how it works")} <ArrowDown size={17} aria-hidden="true" /></a>
          </div>
          <p className="hero-honesty"><span aria-hidden="true" /> {t("Simulated visual sequence · no microphone or store action")}</p>
        </div>
        <DeferredVaaniCore />
      </section>

      <LandingStory />

      <section className="studio page-frame" id="studio" aria-labelledby="studio-title">
          <div className="studio-heading"><h2 id="studio-title">{t("A studio for the")}<br /><em>{t("whole shop.")}</em></h2><p>{t("One place to ask, check and act. These examples illustrate the workspace; your signed-in store shows its own records.")}</p></div>
        <div className="bento">
          <article className="bento-cell bento-command">
            <div className="bento-top"><span>{t("ASSISTANT / COMMAND CENTER")}</span><span className="signal"><i /> {t("Ready to help")}</span></div>
            <div className="command-content"><p className="command-prompt">“{t("Sharma ji ka kitna udhaar hai?")}”</p><div className="command-line"><span className="command-symbol" aria-hidden="true">₹</span><div><strong>{t("Khata balance")}</strong><small>{t("Illustrative ledger result")}</small></div><b>₹770</b></div></div>
            <div className="command-compose"><span>{t("Ask Vaani about your store...")}</span><ArrowUpRight size={18} aria-hidden="true" /></div>
          </article>
          <article className="bento-cell bento-inventory">
            <div className="bento-top"><span>{t("INVENTORY / ILLUSTRATIVE STOCK")}</span><span>०३</span></div>
            <h3>{t("Know what")}<br /><em>{t("needs attention.")}</em></h3>
            <div className="stock-rows"><div><span>Maggi</span><span>{t("48 in stock")}</span><i className="stock-high" /></div><div><span>Amul Milk</span><span>{t("Low · 6 left")}</span><i className="stock-low" /></div><div><span>Parle-G</span><span>{t("90 in stock")}</span><i className="stock-full" /></div></div>
          </article>
          <article className="bento-cell bento-ledger">
            <div className="bento-top"><span>{t("KHATA / ILLUSTRATIVE ACCOUNT")}</span><span>शर्मा जी</span></div><div className="ledger-mark" aria-hidden="true"><span>₹</span></div>
            <h3>{t("Every entry")}<br />{t("accounted for.")}</h3>
            <div className="ledger-lines"><div><span>{t("Gave · opening udhaar")}</span><b>+₹1,000</b></div><div><span>{t("Received · repayment")}</span><b>−₹230</b></div><div className="ledger-total"><span>{t("Example outstanding")}</span><strong>₹770</strong></div></div>
          </article>
          <article className="bento-cell bento-sales">
            <div className="bento-top"><span>{t("SALES / ILLUSTRATIVE DAY")}</span><span>३ {t("recorded sales")}</span></div><div className="sales-total"><small>{t("Example daily total")}</small><strong>₹1,460</strong></div>
            <div className="sales-visual" aria-hidden="true">{[42, 64, 48, 79, 56, 91, 72].map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}</div>
            <p>{t("One glance at the day, grounded in recorded sales when signed in.")}</p>
          </article>
        </div>
      </section>

      <section id="voice-demo" className="landing-demo-section" aria-labelledby="demo-title">
        <div className="landing-frame landing-demo-grid">
          <div className="landing-demo-intro"><p className="landing-eyebrow">{t("REAL AUDIO · MOCK UNDERSTANDING")}</p><h2 id="demo-title">{t("Hear the words.")}<br /><em>{t("See the intent.")}</em></h2><p>{t("Play one of four locally served Gnani voice samples. The structured results shown here are previews; this page never changes store data.")}</p><Link className="landing-text-link dark" href="/signin?mode=signup">{t("Try the assistant")} <ArrowUpRight size={18} aria-hidden="true" /></Link></div>
          <DeferredLandingVoiceDemo />
        </div>
      </section>

      <section className="closing"><div className="page-frame closing-inner"><span className="closing-mark" aria-hidden="true">V</span><div><h2>{t("Commerce moves.")}<br /><em>{t("Vaanlekha keeps pace.")}</em></h2><p>{t("Create an account to work with your own private store records.")}</p></div><Link href="/signin?mode=signup" aria-label={t("Create your account")}><ArrowUpRight size={22} aria-hidden="true" /></Link></div></section>
    </main>
    <footer className="site-footer page-frame"><span>Vaanlekha</span><span>{t("Voice-first tools · trusted store data")}</span></footer>
  </div>;
}
