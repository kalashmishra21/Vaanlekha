import type { Metadata } from "next";
import { z } from "zod";
import { ReviewForm } from "@/components/reviews/review-form";
import { createAnonymousClient } from "@/server/data/anonymous-client";
import { hashReviewToken, reviewTokenSchema } from "@/lib/reviews/tokens";
import "./review.css";

export const metadata: Metadata = { title: "Share feedback | Vaanlekha", robots: { index: false, follow: false } };
const detailSchema = z.object({ shopName: z.string().min(1), saleDate: z.iso.datetime({ offset: true }) });

export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!reviewTokenSchema.safeParse(token).success) return <main className="review-page"><div className="review-sheet"><h1>Link unavailable.</h1><p>Ask the shop for a new review link.</p></div></main>;
  const client = createAnonymousClient();
  const { data, error } = client ? await client.rpc("review_invite_details", { p_token_hash: hashReviewToken(token) }) : { data: null, error: null };
  const detail = !error ? detailSchema.safeParse(data) : null;
  if (!detail?.success) return <main className="review-page"><div className="review-sheet"><h1>Link unavailable.</h1><p>This link has expired or was already used. Ask the shop for another link.</p></div></main>;
  return <main className="review-page"><div className="review-sheet"><p className="review-kicker">VAANLEKHA / CUSTOMER FEEDBACK</p>
    <h1>Your voice matters.</h1><p>Share your experience with <strong>{detail.data.shopName}</strong>. This invitation is linked to a recorded sale on {new Date(detail.data.saleDate).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" })}.</p>
    <ReviewForm token={token} />
  </div></main>;
}
