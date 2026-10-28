import { getSupabaseConfig } from "@/lib/supabase/config";
import { SignInForm } from "@/components/business/sign-in-form";
import { BrandLockup, BrandMark } from "@/components/layout/brand";
import { AppearanceControl } from "@/components/layout/appearance-control";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ mode?: string; error?: string }> }) {
  const configured = Boolean(getSupabaseConfig());
  const params = await searchParams;
  const mode = params.mode === "signup" ? "signup" : params.mode === "reset" ? "reset" : "signin";
  return (
    <main className="auth-page">
      <div className="auth-top"><BrandLockup className="workspace-brand" /><div className="auth-top-controls"><span>SECURE SHOP ACCESS</span><AppearanceControl placement="auth" /></div></div>
      <div className="auth-layout"><section className="auth-intro"><div className="auth-visual-motif" aria-hidden="true"><BrandMark size={420} /></div><p className="workspace-eyebrow">YOUR STORE / ONE CLEAR PLACE</p><h1>Start with<br /><em>your shop.</em></h1><p>Sign in to work with real inventory, khata and sales records. Vaani proposes actions; trusted tools confirm them.</p></section>
        <section className="auth-panel" aria-labelledby="auth-title"><p className="workspace-eyebrow">ACCOUNT ACCESS</p>{configured ? <SignInForm initialMode={mode} linkError={params.error === "link"} /> : <><h2 id="auth-title">Welcome back.</h2><p>Supabase is not configured in this environment yet. Add the project URL and public anon key to the local environment to enable sign-in.</p><p className="auth-footnote">No credentials are stored in the repository.</p></>}</section>
      </div>
    </main>
  );
}
