import { cookies } from "next/headers";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { normalizeLocale, translate } from "@/lib/i18n";
import { SignInForm } from "@/components/business/sign-in-form";
import { BrandLockup, BrandMark } from "@/components/layout/brand";
import { AppearanceControl } from "@/components/layout/appearance-control";
import { LanguageControl } from "@/components/layout/language-control";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ mode?: string; error?: string }> }) {
  const configured = Boolean(getSupabaseConfig());
  const params = await searchParams;
  const locale = normalizeLocale((await cookies()).get("vaanlekha-language")?.value);
  const t = (source: string) => translate(locale, source);
  const mode = params.mode === "signup" ? "signup" : params.mode === "reset" ? "reset" : "signin";
  return (
    <main className="auth-page">
      <div className="auth-top"><BrandLockup className="workspace-brand" /><div className="auth-top-controls"><LanguageControl compact /><span>{t("SECURE SHOP ACCESS")}</span><AppearanceControl placement="auth" /></div></div>
      <div className="auth-layout"><section className="auth-intro"><div className="auth-visual-motif" aria-hidden="true"><BrandMark size={420} /></div><p className="workspace-eyebrow">{t("YOUR STORE / ONE CLEAR PLACE")}</p><h1>{t("Start with")}<br /><em>{t("your shop.")}</em></h1><p>{t("Sign in to work with real inventory, khata and sales records. Vaani proposes actions; trusted tools confirm them.")}</p></section>
        <section className="auth-panel" aria-labelledby="auth-title"><p className="workspace-eyebrow">{t("ACCOUNT ACCESS")}</p>{configured ? <SignInForm initialMode={mode} linkError={params.error === "link"} /> : <><h2 id="auth-title">{t("Welcome back.")}</h2><p>{t("Supabase is not configured in this environment yet. Add the project URL and public anon key to the local environment to enable sign-in.")}</p><p className="auth-footnote">{t("No credentials are stored in the repository.")}</p></>}</section>
      </div>
    </main>
  );
}
