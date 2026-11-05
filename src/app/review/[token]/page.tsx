import type { Metadata } from "next";
import { z } from "zod";
import { cookies } from "next/headers";
import { ReviewForm } from "@/components/reviews/review-form";
import { LanguageControl } from "@/components/layout/language-control";
import { normalizeLocale, translate } from "@/lib/i18n";
import { createAnonymousClient } from "@/server/data/anonymous-client";
import { hashReviewToken, reviewTokenSchema } from "@/lib/reviews/tokens";
import "./review.css";

export const metadata: Metadata = { title: "Share feedback | Vaanlekha", robots: { index: false, follow: false } };
const detailSchema = z.object({ shopName: z.string().min(1), saleDate: z.iso.datetime({ offset: true }) });

export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const locale = normalizeLocale((await cookies()).get("vaanlekha-language")?.value);
  const t = (source: string) => translate(locale, source);
  const { token } = await params;
  if (!reviewTokenSchema.safeParse(token).success) return <main className="review-page"><div className="review-sheet"><LanguageControl /><h1>{t("Link unavailable.")}</h1><p>{t("Ask the shop for a new review link.")}</p></div></main>;
  const client = createAnonymousClient();
  const { data, error } = client ? await client.rpc("review_invite_details", { p_token_hash: hashReviewToken(token) }) : { data: null, error: null };
  const detail = !error ? detailSchema.safeParse(data) : null;
  if (!detail?.success) return <main className="review-page"><div className="review-sheet"><LanguageControl /><h1>{t("Link unavailable.")}</h1><p>{t("This link has expired or was already used. Ask the shop for another link.")}</p></div></main>;
  return <main className="review-page"><div className="review-sheet"><LanguageControl /><p className="review-kicker">{t("VAANLEKHA / CUSTOMER FEEDBACK")}</p>
    <h1>{t("Your voice matters.")}</h1><p>{t("Share your experience with")} <strong>{detail.data.shopName}</strong>. {t("This invitation is linked to a recorded sale on")} {new Date(detail.data.saleDate).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" })}.</p>
    <ReviewForm token={token} />
  </div></main>;
}
