import { z } from "zod";
import { createAnonymousClient } from "@/server/data/anonymous-client";
import { hashReviewToken, reviewTokenSchema } from "@/lib/reviews/tokens";

const schema = z.object({ token: reviewTokenSchema, rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(1).max(1000), customerName: z.string().trim().min(1).max(80).optional() }).strict();

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length")) > 4096) return Response.json({ error: "Review is too long." }, { status: 413 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Send a valid review." }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Choose 1–5 stars and write a short review." }, { status: 422 });
  const client = createAnonymousClient();
  if (!client) return Response.json({ error: "Reviews are unavailable. Please try later." }, { status: 503 });
  const { error } = await client.rpc("submit_customer_review", {
    p_token_hash: hashReviewToken(parsed.data.token), p_rating: parsed.data.rating,
    p_comment: parsed.data.comment, p_customer_name: parsed.data.customerName ?? null,
  });
  if (error) return Response.json({ error: "This review link is expired or already used. Ask the shop for another link." }, { status: 410 });
  return Response.json({ saved: true }, { headers: { "Cache-Control": "no-store" } });
}
